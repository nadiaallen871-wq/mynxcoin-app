import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requestContext, requirePermission } from '../../middleware/auth.js';

const idParam = z.object({ id: z.uuid() });
const roleKey = z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/, 'Use UPPER_SNAKE_CASE (3–64 characters)');
const permissionList = z.array(z.string().min(3).max(100)).max(100);

const listUsersQuery = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'LOCKED', 'CLOSED']).optional(),
  type: z.enum(['INDIVIDUAL', 'INSTITUTIONAL', 'STAFF']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** /api/v1/admin: users, roles and permissions. */
export function accessRoutes({ accessService }) {
  const r = Router();
  const ctx = requestContext;

  r.get('/users', requirePermission('users:read:any'), validate({ query: listUsersQuery }), async (req, res) => {
    res.json(await accessService.listUsers(req.validatedQuery));
  });

  r.post(
    '/users',
    requirePermission('users:manage', 'roles:manage'),
    validate({
      body: z.object({
        email: z.string().trim().toLowerCase().email().max(320),
        firstName: z.string().trim().min(1).max(100),
        lastName: z.string().trim().min(1).max(100),
        roleKeys: z.array(roleKey).min(1).max(10),
      }),
    }),
    async (req, res) => {
      res.status(201).json({ data: await accessService.inviteStaff(req.auth, req.body, ctx(req)) });
    },
  );

  r.get('/users/:id', requirePermission('users:read:any'), validate({ params: idParam }), async (req, res) => {
    res.json({ data: await accessService.getUser(req.params.id) });
  });

  r.post(
    '/users/:id/roles',
    requirePermission('roles:manage'),
    validate({ params: idParam, body: z.object({ roleKey, reason: z.string().trim().max(1000).optional() }) }),
    async (req, res) => {
      const result = await accessService.assignRole(req.auth, req.params.id, req.body.roleKey, ctx(req), { reason: req.body.reason });
      // The most powerful roles need a second approver: 202 means "requested, not yet applied".
      if (result.pendingApproval) return res.status(202).json({ data: result });
      return res.json({ data: result });
    },
  );

  r.delete(
    '/users/:id/roles/:roleKey',
    requirePermission('roles:manage'),
    validate({ params: idParam.extend({ roleKey }) }),
    async (req, res) => {
      res.json({ data: await accessService.revokeRole(req.auth, req.params.id, req.params.roleKey, ctx(req)) });
    },
  );

  r.post(
    '/users/:id/suspend',
    requirePermission('users:manage'),
    validate({ params: idParam, body: z.object({ reason: z.string().trim().min(5).max(500) }) }),
    async (req, res) => {
      res.json({ data: await accessService.suspendUser(req.auth, req.params.id, req.body, ctx(req)) });
    },
  );

  r.post('/users/:id/reactivate', requirePermission('users:manage'), validate({ params: idParam }), async (req, res) => {
    res.json({ data: await accessService.reactivateUser(req.auth, req.params.id, ctx(req)) });
  });

  r.post('/users/:id/sessions/revoke', requirePermission('sessions:revoke:any'), validate({ params: idParam }), async (req, res) => {
    res.json({ data: await accessService.revokeUserSessions(req.auth, req.params.id, ctx(req)) });
  });

  r.get('/permissions', requirePermission('roles:read'), async (_req, res) => {
    res.json({ data: await accessService.listPermissions() });
  });

  r.get('/roles', requirePermission('roles:read'), async (_req, res) => {
    res.json({ data: await accessService.listRoles() });
  });

  r.post(
    '/roles',
    requirePermission('roles:manage'),
    validate({
      body: z.object({
        key: roleKey,
        name: z.string().trim().min(2).max(120),
        description: z.string().trim().max(500).optional(),
        permissions: permissionList.min(1),
      }),
    }),
    async (req, res) => {
      res.status(201).json({ data: await accessService.createRole(req.auth, req.body, ctx(req)) });
    },
  );

  r.patch(
    '/roles/:key',
    requirePermission('roles:manage'),
    validate({
      params: z.object({ key: roleKey }),
      body: z
        .object({
          name: z.string().trim().min(2).max(120).optional(),
          description: z.string().trim().max(500).nullable().optional(),
          permissions: permissionList.min(1).optional(),
        })
        .strict(),
    }),
    async (req, res) => {
      res.json({ data: await accessService.updateRole(req.auth, req.params.key, req.body, ctx(req)) });
    },
  );

  r.delete('/roles/:key', requirePermission('roles:manage'), validate({ params: z.object({ key: roleKey }) }), async (req, res) => {
    await accessService.deleteRole(req.auth, req.params.key, ctx(req));
    res.status(204).end();
  });

  return r;
}
