import { CONFLICTING_PERMISSIONS, PERMISSIONS } from '../../config/permissions.js';
import { isStaffPermission } from '../../middleware/auth.js';
import { AppError, BadRequestError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';

const INVESTOR_ROLE_KEYS = new Set(['INDIVIDUAL_INVESTOR', 'INSTITUTIONAL_INVESTOR']);

/** Returns the first conflicting pair found in a permission set, or null. */
export function findConflict(permissionKeys) {
  const set = new Set(permissionKeys);
  return CONFLICTING_PERMISSIONS.find(([a, b]) => set.has(a) && set.has(b)) ?? null;
}

const conflictError = ([a, b]) =>
  new ConflictError(`Separation of duties: "${a}" and "${b}" cannot be held together`, 'SEPARATION_OF_DUTIES');

/**
 * Administration of users, roles and permissions.
 *
 * Guard rails enforced here, independent of the UI:
 * - Staff cannot change their own roles or suspend themselves.
 * - Staff roles go only to STAFF accounts, and investor roles only to investor accounts.
 * - No user (through any combination of roles) and no role may hold a conflicting permission pair.
 * - System roles are defined in code and are read-only here. Custom roles in use cannot be deleted.
 * - The last Super Administrator cannot be removed.
 * Every change is audited. Maker-checker approval for sensitive grants arrives in Phase 8.
 */
/** Roles powerful enough that granting them needs a second approver (maker-checker). */
export const APPROVAL_REQUIRED_ROLES = new Set(['SUPER_ADMIN', 'ADMIN']);

export function createAccessService({ prisma, tokens, messaging, audit, users, sessions, approvals = null }) {
  async function rolePermissionKeys(tx, roleIds) {
    const rows = await tx.permission.findMany({ where: { roles: { some: { roleId: { in: roleIds } } } }, select: { key: true } });
    return rows.map((r) => r.key);
  }

  /** Every rule a role grant must satisfy. Used for direct grants, approval requests and when an approval is applied. */
  async function checkGrant(tx, userId, roleKey) {
    const user = await tx.user.findUnique({ where: { id: userId }, include: { roles: true } });
    if (!user) throw new NotFoundError('User not found');
    const role = await tx.role.findUnique({ where: { key: roleKey } });
    if (!role) throw new NotFoundError('Role not found');
    if (user.roles.some((r) => r.roleId === role.id)) throw new ConflictError('User already has this role', 'ROLE_ALREADY_ASSIGNED');
    const isInvestorRole = INVESTOR_ROLE_KEYS.has(role.key);
    if (isInvestorRole === (user.type === 'STAFF')) {
      throw new BadRequestError(
        isInvestorRole ? 'Investor roles cannot be given to staff accounts' : 'Staff roles can only be given to staff accounts',
        'ROLE_TYPE_MISMATCH',
      );
    }
    const conflict = findConflict(await rolePermissionKeys(tx, [...user.roles.map((r) => r.roleId), role.id]));
    if (conflict) throw conflictError(conflict);
    return { user, role };
  }

  approvals?.register('ROLE_GRANT', {
    permission: 'roles:manage',
    assertDecider(payload, auth) {
      if (payload.userId === auth.user.id) throw new ForbiddenError('You cannot approve a role for yourself');
    },
    async apply(tx, { userId, roleKey }, { decider, request }) {
      const { role } = await checkGrant(tx, userId, roleKey);
      await tx.userRole.create({ data: { userId, roleId: role.id, grantedById: decider.id } });
      await audit.record(
        {
          actorId: decider.id,
          action: 'admin.role_assigned',
          entityType: 'user',
          entityId: userId,
          after: { role: roleKey },
          metadata: { approvalRequestId: request.id, requestedBy: request.requestedById },
        },
        tx,
      );
      return { userId, roleKey };
    },
  });

  function assertNotSelf(auth, userId, action) {
    if (auth.user.id === userId) throw new ForbiddenError(`You cannot ${action} your own account`);
  }

  function serializeUser(u) {
    return {
      id: u.id,
      email: u.email,
      type: u.type,
      status: u.status,
      firstName: u.profile?.firstName ?? null,
      lastName: u.profile?.lastName ?? null,
      organizationName: u.profile?.organizationName ?? null,
      emailVerified: Boolean(u.emailVerifiedAt),
      phoneVerified: Boolean(u.phoneVerifiedAt),
      mfaEnabled: Boolean(u.mfa?.enabledAt),
      roles: (u.roles ?? []).map((r) => r.role.key).sort(),
      lastLoginAt: u.lastLoginAt,
      lockedUntil: u.lockedUntil,
      createdAt: u.createdAt,
    };
  }

  const userInclude = { profile: true, mfa: { select: { enabledAt: true } }, roles: { include: { role: { select: { key: true } } } } };

  return {
    async listUsers({ search, status, type, page, pageSize }) {
      const where = {
        ...(status ? { status } : {}),
        ...(type ? { type } : {}),
        ...(search
          ? {
              OR: [
                { email: { contains: search, mode: 'insensitive' } },
                { profile: { firstName: { contains: search, mode: 'insensitive' } } },
                { profile: { lastName: { contains: search, mode: 'insensitive' } } },
                { profile: { organizationName: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      };
      const [total, rows] = await prisma.$transaction([
        prisma.user.count({ where }),
        prisma.user.findMany({ where, include: userInclude, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      ]);
      return { data: rows.map(serializeUser), meta: { page, pageSize, total } };
    },

    async getUser(userId) {
      const user = await prisma.user.findUnique({ where: { id: userId }, include: userInclude });
      if (!user) throw new NotFoundError('User not found');
      const activeSessions = await prisma.userSession.count({ where: { userId, revokedAt: null, absoluteExpiresAt: { gt: new Date() } } });
      return { ...serializeUser(user), activeSessions };
    },

    /** Creates a STAFF account and emails a one-time setup link. No password is ever chosen or seen by the admin. */
    async inviteStaff(auth, { email: rawEmail, firstName, lastName, roleKeys }, ctx) {
      const email = users.normalizeEmail(rawEmail);
      const roles = await prisma.role.findMany({ where: { key: { in: roleKeys } } });
      if (roles.length !== new Set(roleKeys).size) throw new BadRequestError('One or more roles do not exist', 'ROLE_NOT_FOUND');
      if (roles.some((r) => INVESTOR_ROLE_KEYS.has(r.key)))
        throw new BadRequestError('Investor roles cannot be given to staff accounts', 'ROLE_TYPE_MISMATCH');
      const conflict = findConflict(
        await rolePermissionKeys(
          prisma,
          roles.map((r) => r.id),
        ),
      );
      if (conflict) throw conflictError(conflict);

      let result;
      try {
        result = await prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              email,
              type: 'STAFF',
              status: 'PENDING_VERIFICATION',
              profile: { create: { firstName, lastName } },
              roles: { create: roles.map((r) => ({ roleId: r.id, grantedById: auth.user.id })) },
            },
          });
          const { raw } = await tokens.issue(tx, { userId: user.id, type: 'ACCOUNT_SETUP', target: email });
          await audit.record(
            {
              actorId: auth.user.id,
              action: 'admin.staff_invited',
              entityType: 'user',
              entityId: user.id,
              after: { email, roles: roleKeys },
              ...ctx,
            },
            tx,
          );
          const message = await messaging.queue(tx, {
            userId: user.id,
            recipient: email,
            template: 'account-setup',
            vars: { firstName, link: tokens.link('/reset-password', raw) },
          });
          return { user, message };
        });
      } catch (err) {
        if (err.code === 'P2002') throw new ConflictError('An account with this email already exists', 'EMAIL_IN_USE');
        throw err;
      }
      await messaging.dispatch([result.message]);
      return this.getUser(result.user.id);
    },

    /**
     * Grants a role. Grants of the most powerful roles are not applied directly: they
     * become an approval request (returned as `{ pendingApproval }`) that a different
     * person with `approvals:decide` and `roles:manage` must approve.
     */
    async assignRole(auth, userId, roleKey, ctx, { reason } = {}) {
      assertNotSelf(auth, userId, 'change roles on');
      if (approvals && APPROVAL_REQUIRED_ROLES.has(roleKey)) {
        if (!reason || reason.trim().length < 10) {
          throw new ValidationError([
            { location: 'body', path: 'reason', message: 'Explain why this person needs this role (at least 10 characters)' },
          ]);
        }
        const request = await prisma.$transaction(async (tx) => {
          await checkGrant(tx, userId, roleKey);
          const open = await tx.approvalRequest.findFirst({
            where: {
              type: 'ROLE_GRANT',
              status: 'PENDING',
              AND: [{ payload: { path: ['userId'], equals: userId } }, { payload: { path: ['roleKey'], equals: roleKey } }],
            },
          });
          if (open) throw new ConflictError('This role grant is already waiting for approval', 'ALREADY_PENDING');
          const target = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
          return approvals.create(
            tx,
            {
              type: 'ROLE_GRANT',
              payload: { userId, roleKey },
              summary: `Grant ${roleKey} to ${target.email}`,
              reason,
              requestedById: auth.user.id,
            },
            ctx,
          );
        });
        return { pendingApproval: await approvals.get(request.id) };
      }
      await prisma.$transaction(async (tx) => {
        const { role } = await checkGrant(tx, userId, roleKey);
        await tx.userRole.create({ data: { userId, roleId: role.id, grantedById: auth.user.id } });
        await audit.record(
          { actorId: auth.user.id, action: 'admin.role_assigned', entityType: 'user', entityId: userId, after: { role: roleKey }, ...ctx },
          tx,
        );
      });
      return this.getUser(userId);
    },

    async revokeRole(auth, userId, roleKey, ctx) {
      assertNotSelf(auth, userId, 'change roles on');
      await prisma.$transaction(async (tx) => {
        const role = await tx.role.findUnique({ where: { key: roleKey } });
        if (!role) throw new NotFoundError('Role not found');
        if (role.key === 'SUPER_ADMIN') {
          const holders = await tx.userRole.count({ where: { roleId: role.id, user: { status: 'ACTIVE' } } });
          if (holders <= 1) throw new ConflictError('The last Super Administrator cannot be removed', 'LAST_SUPER_ADMIN');
        }
        const { count } = await tx.userRole.deleteMany({ where: { userId, roleId: role.id } });
        if (!count) throw new NotFoundError('User does not have this role');
        // Changed privileges take effect immediately: permissions are read per request.
        await audit.record(
          { actorId: auth.user.id, action: 'admin.role_revoked', entityType: 'user', entityId: userId, before: { role: roleKey }, ...ctx },
          tx,
        );
      });
      return this.getUser(userId);
    },

    async suspendUser(auth, userId, { reason }, ctx) {
      assertNotSelf(auth, userId, 'suspend');
      const message = await prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { id: userId }, include: { profile: true } });
        if (!user) throw new NotFoundError('User not found');
        if (user.status === 'SUSPENDED') throw new ConflictError('User is already suspended', 'ALREADY_SUSPENDED');
        if (user.status === 'CLOSED') throw new ConflictError('Closed accounts cannot be suspended', 'ACCOUNT_CLOSED');
        await tx.user.update({ where: { id: userId }, data: { status: 'SUSPENDED' } });
        const revoked = await sessions.revokeAllForUser(userId, 'suspended', {}, tx);
        await audit.record(
          {
            actorId: auth.user.id,
            action: 'admin.user_suspended',
            entityType: 'user',
            entityId: userId,
            before: { status: user.status },
            after: { status: 'SUSPENDED' },
            metadata: { reason, sessionsRevoked: revoked },
            ...ctx,
          },
          tx,
        );
        return messaging.queue(tx, {
          userId,
          recipient: user.email,
          template: 'account-suspended',
          vars: { firstName: user.profile?.firstName ?? 'there' },
        });
      });
      await messaging.dispatch([message]);
      return this.getUser(userId);
    },

    async reactivateUser(auth, userId, ctx) {
      assertNotSelf(auth, userId, 'reactivate');
      await prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundError('User not found');
        if (user.status !== 'SUSPENDED') throw new ConflictError('Only suspended accounts can be reactivated', 'NOT_SUSPENDED');
        const status = user.passwordHash && user.emailVerifiedAt ? 'ACTIVE' : 'PENDING_VERIFICATION';
        await tx.user.update({ where: { id: userId }, data: { status, failedLoginCount: 0, lockedUntil: null } });
        await audit.record(
          {
            actorId: auth.user.id,
            action: 'admin.user_reactivated',
            entityType: 'user',
            entityId: userId,
            before: { status: 'SUSPENDED' },
            after: { status },
            ...ctx,
          },
          tx,
        );
      });
      return this.getUser(userId);
    },

    async revokeUserSessions(auth, userId, ctx) {
      const exists = await prisma.user.count({ where: { id: userId } });
      if (!exists) throw new NotFoundError('User not found');
      const count = await sessions.revokeAllForUser(
        userId,
        'revoked_by_admin',
        auth.user.id === userId ? { exceptSessionId: auth.session.id } : {},
      );
      await audit.record({
        actorId: auth.user.id,
        action: 'admin.sessions_revoked',
        entityType: 'user',
        entityId: userId,
        metadata: { count },
        ...ctx,
      });
      return { revoked: count };
    },

    async listPermissions() {
      return Object.entries(PERMISSIONS).map(([key, description]) => ({ key, description, staff: isStaffPermission(key) }));
    },

    async listRoles() {
      const roles = await prisma.role.findMany({
        include: { permissions: { include: { permission: { select: { key: true } } } }, _count: { select: { users: true } } },
        orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      });
      return roles.map((r) => ({
        key: r.key,
        name: r.name,
        description: r.description,
        isSystem: r.isSystem,
        userCount: r._count.users,
        permissions: r.permissions.map((p) => p.permission.key).sort(),
      }));
    },

    async createRole(auth, { key, name, description, permissions }, ctx) {
      validatePermissionSet(permissions);
      try {
        await prisma.$transaction(async (tx) => {
          const perms = await tx.permission.findMany({ where: { key: { in: permissions } } });
          await tx.role.create({
            data: { key, name, description, isSystem: false, permissions: { create: perms.map((p) => ({ permissionId: p.id })) } },
          });
          await audit.record(
            {
              actorId: auth.user.id,
              action: 'admin.role_created',
              entityType: 'role',
              entityId: key,
              after: { name, permissions },
              ...ctx,
            },
            tx,
          );
        });
      } catch (err) {
        if (err.code === 'P2002') throw new ConflictError('A role with this key already exists', 'ROLE_EXISTS');
        throw err;
      }
      return (await this.listRoles()).find((r) => r.key === key);
    },

    async updateRole(auth, key, { name, description, permissions }, ctx) {
      await prisma.$transaction(async (tx) => {
        const role = await tx.role.findUnique({ where: { key }, include: { permissions: { include: { permission: true } }, users: true } });
        if (!role) throw new NotFoundError('Role not found');
        if (role.isSystem) throw new ConflictError('System roles are managed in code and cannot be edited', 'SYSTEM_ROLE');
        const before = {
          name: role.name,
          description: role.description,
          permissions: role.permissions.map((p) => p.permission.key).sort(),
        };
        if (permissions) {
          validatePermissionSet(permissions);
          // A role change must not create a conflict for any existing holder via their other roles.
          for (const holder of role.users) {
            const otherRoleIds = (await tx.userRole.findMany({ where: { userId: holder.userId, roleId: { not: role.id } } })).map(
              (r) => r.roleId,
            );
            const conflict = findConflict([...(await rolePermissionKeys(tx, otherRoleIds)), ...permissions]);
            if (conflict) throw conflictError(conflict);
          }
          const perms = await tx.permission.findMany({ where: { key: { in: permissions } } });
          await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
          await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
        }
        await tx.role.update({
          where: { id: role.id },
          data: { ...(name ? { name } : {}), ...(description !== undefined ? { description } : {}) },
        });
        await audit.record(
          {
            actorId: auth.user.id,
            action: 'admin.role_updated',
            entityType: 'role',
            entityId: key,
            before,
            after: { name, description, permissions },
            ...ctx,
          },
          tx,
        );
      });
      return (await this.listRoles()).find((r) => r.key === key);
    },

    async deleteRole(auth, key, ctx) {
      await prisma.$transaction(async (tx) => {
        const role = await tx.role.findUnique({ where: { key }, include: { _count: { select: { users: true } } } });
        if (!role) throw new NotFoundError('Role not found');
        if (role.isSystem) throw new ConflictError('System roles cannot be deleted', 'SYSTEM_ROLE');
        if (role._count.users > 0) throw new ConflictError('Remove this role from all users before deleting it', 'ROLE_IN_USE');
        await tx.role.delete({ where: { id: role.id } });
        await audit.record({ actorId: auth.user.id, action: 'admin.role_deleted', entityType: 'role', entityId: key, ...ctx }, tx);
      });
    },
  };

  function validatePermissionSet(permissions) {
    const unknown = permissions.filter((p) => !PERMISSIONS[p]);
    if (unknown.length)
      throw new ValidationError([
        { location: 'body', path: 'permissions', message: `Unknown permissions: ${unknown.join(', ')}`, code: 'unknown_permission' },
      ]);
    if (permissions.some((p) => !isStaffPermission(p))) {
      throw new AppError('Custom roles are for staff. Investor self-service permissions come from the investor roles.', {
        status: 400,
        code: 'INVESTOR_PERMISSION_IN_CUSTOM_ROLE',
      });
    }
    const conflict = findConflict(permissions);
    if (conflict) throw conflictError(conflict);
  }
}
