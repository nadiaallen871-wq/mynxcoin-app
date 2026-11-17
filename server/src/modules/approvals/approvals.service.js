import { ConflictError, ForbiddenError, NotFoundError } from '../../utils/errors.js';

const TTL_MS = 7 * 86_400_000;

/**
 * Maker-checker for high-risk administrative actions.
 *
 * A maker creates a request with a reason; nothing changes yet. A checker (a different
 * person, enforced by a DB check) holding `approvals:decide` plus any permission the
 * type requires approves or rejects it. On approval the type's handler re-validates
 * and applies the change in the same transaction. If the world changed since the
 * request (for example the setting was changed by someone else), the request is
 * marked FAILED instead of applying a stale change. Requests expire after 7 days.
 *
 * Handlers: { permission?, apply(tx, payload, { decider, request }) -> after, describe?(payload) }
 */
export function createApprovalsService({ prisma, audit }) {
  const handlers = new Map();
  const name = (u) => (u?.profile ? `${u.profile.firstName} ${u.profile.lastName}` : (u?.email ?? null));
  const person = { select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } } };

  const serialize = (r) => ({
    id: r.id,
    type: r.type,
    status: r.status,
    summary: r.summary,
    reason: r.reason,
    payload: r.payload,
    decisionNote: r.decisionNote,
    error: r.error,
    requestedBy: r.requestedBy ? { id: r.requestedBy.id, name: name(r.requestedBy) } : { id: r.requestedById },
    decidedBy: r.decidedBy ? { id: r.decidedBy.id, name: name(r.decidedBy) } : null,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    decidedAt: r.decidedAt,
  });

  async function expireStale() {
    await prisma.approvalRequest.updateMany({ where: { status: 'PENDING', expiresAt: { lt: new Date() } }, data: { status: 'EXPIRED' } });
  }

  async function load(id) {
    const r = await prisma.approvalRequest.findUnique({ where: { id }, include: { requestedBy: person, decidedBy: person } });
    if (!r) throw new NotFoundError('Approval request not found');
    return r;
  }

  return {
    register(type, handler) {
      handlers.set(type, handler);
    },

    /** Creates a pending request inside the caller's transaction. */
    async create(tx, { type, payload, summary, reason, requestedById }, ctx = {}) {
      if (!handlers.has(type)) throw new Error(`No approval handler for ${type}`);
      const r = await tx.approvalRequest.create({
        data: { type, payload, summary, reason, requestedById, expiresAt: new Date(Date.now() + TTL_MS) },
      });
      await audit.record(
        {
          actorId: requestedById,
          action: 'approval.requested',
          entityType: 'approval_request',
          entityId: r.id,
          after: { type, summary, payload },
          ...ctx,
        },
        tx,
      );
      return r;
    },

    async list({ status = 'PENDING', type, mine, staffId, page = 1, pageSize = 25 }) {
      await expireStale();
      const where = { ...(status === 'ALL' ? {} : { status }), ...(type ? { type } : {}), ...(mine ? { requestedById: staffId } : {}) };
      const [total, rows] = await prisma.$transaction([
        prisma.approvalRequest.count({ where }),
        prisma.approvalRequest.findMany({
          where,
          include: { requestedBy: person, decidedBy: person },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      return { data: rows.map(serialize), meta: { page, pageSize, total } };
    },

    async pendingCount() {
      await expireStale();
      return prisma.approvalRequest.count({ where: { status: 'PENDING' } });
    },

    async get(id) {
      return serialize(await load(id));
    },

    async decide(auth, id, { approve, note }, ctx) {
      await expireStale();
      const r = await load(id);
      if (r.status !== 'PENDING') throw new ConflictError(`This request is ${r.status.toLowerCase()}`, 'NOT_PENDING');
      if (r.requestedById === auth.user.id) throw new ForbiddenError('Four-eyes rule: someone other than the requester must decide');
      const handler = handlers.get(r.type);
      const granted = await auth.permissions();
      if (handler.permission && !granted.includes(handler.permission))
        throw new ForbiddenError(`Deciding this request also needs the ${handler.permission} permission`);
      handler.assertDecider?.(r.payload, auth);

      if (!approve) {
        await prisma.$transaction(async (tx) => {
          const { count } = await tx.approvalRequest.updateMany({
            where: { id, status: 'PENDING' },
            data: { status: 'REJECTED', decidedById: auth.user.id, decidedAt: new Date(), decisionNote: note },
          });
          if (count !== 1) throw new ConflictError('This request was already decided', 'NOT_PENDING');
          await audit.record(
            {
              actorId: auth.user.id,
              action: 'approval.rejected',
              entityType: 'approval_request',
              entityId: id,
              metadata: { note, type: r.type },
              ...ctx,
            },
            tx,
          );
        });
        return this.get(id);
      }

      let failure = null;
      try {
        await prisma.$transaction(async (tx) => {
          const { count } = await tx.approvalRequest.updateMany({
            where: { id, status: 'PENDING' },
            data: { status: 'APPROVED', decidedById: auth.user.id, decidedAt: new Date(), decisionNote: note },
          });
          if (count !== 1) throw new ConflictError('This request was already decided', 'NOT_PENDING');
          const after = await handler.apply(tx, r.payload, { decider: auth.user, request: r });
          await audit.record(
            {
              actorId: auth.user.id,
              action: 'approval.approved',
              entityType: 'approval_request',
              entityId: id,
              after,
              metadata: { note, type: r.type },
              ...ctx,
            },
            tx,
          );
        });
        handler.afterCommit?.(r.payload);
      } catch (err) {
        if (err.code === 'NOT_PENDING') throw err;
        if (!(err.status >= 400 && err.status < 500)) throw err;
        failure = err.message;
      }
      if (failure) {
        // The change no longer applies cleanly (e.g. the value was changed meanwhile). Record why; nothing was applied.
        await prisma.$transaction(async (tx) => {
          await tx.approvalRequest.updateMany({
            where: { id, status: 'PENDING' },
            data: { status: 'FAILED', decidedById: auth.user.id, decidedAt: new Date(), decisionNote: note, error: failure.slice(0, 500) },
          });
          await audit.record(
            {
              actorId: auth.user.id,
              action: 'approval.failed',
              entityType: 'approval_request',
              entityId: id,
              metadata: { error: failure },
              ...ctx,
            },
            tx,
          );
        });
      }
      return this.get(id);
    },

    async cancel(auth, id, ctx) {
      const r = await load(id);
      if (r.requestedById !== auth.user.id) throw new ForbiddenError('Only the requester can withdraw a request');
      const { count } = await prisma.approvalRequest.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
      if (count !== 1) throw new ConflictError('This request is no longer pending', 'NOT_PENDING');
      await audit.record({ actorId: auth.user.id, action: 'approval.cancelled', entityType: 'approval_request', entityId: id, ...ctx });
      return this.get(id);
    },
  };
}
