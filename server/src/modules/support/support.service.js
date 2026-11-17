import { randomUUID } from 'node:crypto';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { ALLOWED_TYPES, detectMimeType, sanitizeFilename, sha256 } from '../documents/file-validation.js';
import { firstNameOf } from '../payments/payment-helpers.js';

/** Staff status changes. Customers only reply (which reopens) or close a resolved ticket. */
const STAFF_TRANSITIONS = {
  OPEN: ['IN_PROGRESS', 'AWAITING_CUSTOMER', 'ESCALATED', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['AWAITING_CUSTOMER', 'ESCALATED', 'RESOLVED', 'CLOSED'],
  AWAITING_CUSTOMER: ['IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED'],
  ESCALATED: ['IN_PROGRESS', 'AWAITING_CUSTOMER', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: [],
};
const MAX_FILES = 3;

/**
 * Customer support tickets, conversations, internal notes, attachments and FAQs.
 *
 * Least privilege: agents see the customer's name, email and their tickets, never
 * balances, transactions or identity documents. Internal notes are never returned
 * to the customer. Complaints cannot be closed without a recorded resolution.
 */
export function createSupportService({ prisma, storage, scanner, messaging, audit }) {
  const name = (u) => (u?.profile ? `${u.profile.firstName} ${u.profile.lastName}` : (u?.email ?? null));
  const person = { select: { id: true, email: true, type: true, profile: { select: { firstName: true, lastName: true } } } };

  const serializeTicket = (t, { staff = false } = {}) => ({
    id: t.id,
    number: t.number,
    category: t.category,
    priority: t.priority,
    status: t.status,
    subject: t.subject,
    isComplaint: t.isComplaint,
    resolution: t.resolution,
    createdAt: t.createdAt,
    lastActivityAt: t.lastActivityAt,
    resolvedAt: t.resolvedAt,
    closedAt: t.closedAt,
    ...(staff
      ? {
          firstResponseAt: t.firstResponseAt,
          customer: t.user && { id: t.user.id, name: name(t.user), email: t.user.email, type: t.user.type },
          assignee: t.assignee ? { id: t.assignee.id, name: name(t.assignee) } : null,
        }
      : {}),
  });

  const serializeMessage = (m, ticketOwnerId) => ({
    id: m.id,
    body: m.body,
    internal: m.internal,
    fromCustomer: m.authorId === ticketOwnerId,
    author: m.authorId === ticketOwnerId ? 'You' : (m.author?.profile?.firstName ?? 'Support'),
    createdAt: m.createdAt,
    attachments: (m.attachments ?? []).map((a) => ({
      id: a.id,
      filename: a.originalFilename,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
    })),
  });

  async function storeFiles(files, ownerId) {
    if (files.length > MAX_FILES)
      throw new ValidationError([{ location: 'body', path: 'files', message: `Attach up to ${MAX_FILES} files` }]);
    const stored = [];
    for (const file of files) {
      const mimeType = detectMimeType(file.buffer);
      if (!mimeType) throw new AppError('Attach JPEG, PNG or PDF files only', { status: 415, code: 'UNSUPPORTED_FILE_TYPE' });
      const scan = await scanner.scan(file.buffer, mimeType);
      if (!scan.clean) throw new AppError(`This file was rejected: ${scan.reason}`, { status: 422, code: 'FILE_REJECTED' });
      const storageKey = `support/${ownerId}/${randomUUID()}.${ALLOWED_TYPES[mimeType].ext}`;
      await storage.put(storageKey, file.buffer);
      stored.push({
        storageKey,
        originalFilename: sanitizeFilename(file.originalname),
        mimeType,
        sizeBytes: file.buffer.length,
        sha256: sha256(file.buffer),
      });
    }
    return stored;
  }

  async function withCleanup(stored, fn) {
    try {
      return await fn();
    } catch (err) {
      await Promise.all(stored.map((f) => storage.delete(f.storageKey).catch(() => {})));
      throw err;
    }
  }

  async function addMessage(tx, { ticketId, authorId, body, internal = false, files = [] }) {
    return tx.supportMessage.create({
      data: { ticketId, authorId, body, internal, attachments: { create: files } },
      include: { attachments: true, author: { select: { profile: { select: { firstName: true } } } } },
    });
  }

  async function notifyCustomer(tx, ticket, template) {
    const u = await tx.user.findUnique({ where: { id: ticket.userId }, select: { email: true } });
    return messaging.queue(tx, {
      userId: ticket.userId,
      recipient: u.email,
      template,
      vars: { firstName: await firstNameOf(tx, ticket.userId), number: ticket.number, subject: ticket.subject },
    });
  }

  async function ownTicket(auth, id) {
    const t = await prisma.supportTicket.findUnique({ where: { id } });
    if (!t || t.userId !== auth.user.id) throw new NotFoundError('Request not found');
    return t;
  }

  async function loadForStaff(id) {
    const t = await prisma.supportTicket.findUnique({
      where: { id },
      include: {
        user: person,
        assignee: person,
        messages: {
          orderBy: { createdAt: 'asc' },
          include: { attachments: true, author: { select: { profile: { select: { firstName: true } } } } },
        },
      },
    });
    if (!t) throw new NotFoundError('Ticket not found');
    return t;
  }

  const staffView = async (id) => {
    const t = await loadForStaff(id);
    const otherTickets = await prisma.supportTicket.count({ where: { userId: t.userId, id: { not: t.id } } });
    return {
      ...serializeTicket(t, { staff: true }),
      customerOtherTickets: otherTickets,
      messages: t.messages.map((m) => serializeMessage(m, t.userId)),
    };
  };

  return {
    // ── Customer ───────────────────────────────────────────────────────────

    async create(auth, { category, subject, body, priority = 'NORMAL' }, files, ctx) {
      const stored = await storeFiles(files, auth.user.id);
      return withCleanup(stored, async () => {
        const isComplaint = category === 'COMPLAINT';
        const { ticket, message } = await prisma.$transaction(async (tx) => {
          const t = await tx.supportTicket.create({
            data: {
              userId: auth.user.id,
              category,
              subject,
              isComplaint,
              priority: isComplaint && priority === 'LOW' ? 'NORMAL' : priority,
            },
          });
          await addMessage(tx, { ticketId: t.id, authorId: auth.user.id, body, files: stored });
          await audit.record(
            {
              actorId: auth.user.id,
              action: 'support.ticket_created',
              entityType: 'support_ticket',
              entityId: t.id,
              metadata: { category, isComplaint },
              ...ctx,
            },
            tx,
          );
          return { ticket: t, message: await notifyCustomer(tx, t, 'ticket-created') };
        });
        await messaging.dispatch([message]);
        return this.getOwn(auth, ticket.id);
      });
    },

    async listOwn(auth, { page = 1, pageSize = 20 } = {}) {
      const where = { userId: auth.user.id };
      const [total, rows] = await prisma.$transaction([
        prisma.supportTicket.count({ where }),
        prisma.supportTicket.findMany({ where, orderBy: { lastActivityAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      ]);
      return { data: rows.map((t) => serializeTicket(t)), meta: { page, pageSize, total } };
    },

    async getOwn(auth, id) {
      const t = await ownTicket(auth, id);
      const messages = await prisma.supportMessage.findMany({
        where: { ticketId: id, internal: false },
        orderBy: { createdAt: 'asc' },
        include: { attachments: true, author: { select: { profile: { select: { firstName: true } } } } },
      });
      return { ...serializeTicket(t), messages: messages.map((m) => serializeMessage(m, t.userId)) };
    },

    /** A customer reply reopens a resolved or waiting ticket. Closed tickets stay closed. */
    async replyOwn(auth, id, { body }, files, ctx) {
      const t = await ownTicket(auth, id);
      if (t.status === 'CLOSED')
        throw new ConflictError('This request is closed. Open a new request if you still need help.', 'TICKET_CLOSED');
      const stored = await storeFiles(files, auth.user.id);
      return withCleanup(stored, async () => {
        await prisma.$transaction(async (tx) => {
          await addMessage(tx, { ticketId: id, authorId: auth.user.id, body, files: stored });
          const reopen = ['AWAITING_CUSTOMER', 'RESOLVED'].includes(t.status);
          await tx.supportTicket.update({
            where: { id },
            data: { lastActivityAt: new Date(), ...(reopen ? { status: 'OPEN', resolvedAt: null } : {}) },
          });
          if (reopen)
            await audit.record(
              { actorId: auth.user.id, action: 'support.ticket_reopened', entityType: 'support_ticket', entityId: id, ...ctx },
              tx,
            );
        });
        return this.getOwn(auth, id);
      });
    },

    async closeOwn(auth, id, ctx) {
      const t = await ownTicket(auth, id);
      if (t.status !== 'RESOLVED') throw new ConflictError('You can close a request once it is resolved', 'NOT_RESOLVED');
      await prisma.$transaction(async (tx) => {
        await tx.supportTicket.update({ where: { id }, data: { status: 'CLOSED', closedAt: new Date() } });
        await audit.record(
          { actorId: auth.user.id, action: 'support.ticket_closed', entityType: 'support_ticket', entityId: id, ...ctx },
          tx,
        );
      });
      return this.getOwn(auth, id);
    },

    /** Owner, or support staff for non-internal and internal attachments alike. */
    async attachment(auth, attachmentId, { isSupportStaff }) {
      const a = await prisma.supportAttachment.findUnique({
        where: { id: attachmentId },
        include: { message: { include: { ticket: true } } },
      });
      const owner = a?.message.ticket.userId === auth.user.id;
      if (!a || !(isSupportStaff || (owner && !a.message.internal))) throw new NotFoundError('Attachment not found');
      const buffer = await storage.get(a.storageKey);
      if (sha256(buffer) !== a.sha256) throw new AppError('Attachment integrity check failed', { status: 500, code: 'DOCUMENT_INTEGRITY' });
      return { buffer, mimeType: a.mimeType, filename: a.originalFilename };
    },

    // ── Staff ──────────────────────────────────────────────────────────────

    async queue({ status, priority, category, assignee, staffId, page = 1, pageSize = 25 }) {
      const where = {
        ...(status ? { status } : { status: { notIn: ['CLOSED'] } }),
        ...(priority ? { priority } : {}),
        ...(category ? { category } : {}),
        ...(assignee === 'me' ? { assigneeId: staffId } : assignee === 'unassigned' ? { assigneeId: null } : {}),
      };
      const [total, rows] = await prisma.$transaction([
        prisma.supportTicket.count({ where }),
        prisma.supportTicket.findMany({
          where,
          include: { user: person, assignee: person },
          // Enum order puts URGENT last, so sort priority descending.
          orderBy: [{ priority: 'desc' }, { lastActivityAt: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      return { data: rows.map((t) => serializeTicket(t, { staff: true })), meta: { page, pageSize, total } };
    },

    getForStaff: staffView,

    async replyStaff(auth, id, { body, internal = false }, files, ctx) {
      const t = await prisma.supportTicket.findUnique({ where: { id } });
      if (!t) throw new NotFoundError('Ticket not found');
      if (t.userId === auth.user.id) throw new ForbiddenError('You cannot handle your own request');
      if (t.status === 'CLOSED') throw new ConflictError('This ticket is closed', 'TICKET_CLOSED');
      const stored = await storeFiles(files, t.userId);
      return withCleanup(stored, async () => {
        const message = await prisma.$transaction(async (tx) => {
          await addMessage(tx, { ticketId: id, authorId: auth.user.id, body, internal, files: stored });
          const now = new Date();
          await tx.supportTicket.update({
            where: { id },
            data: internal
              ? { lastActivityAt: now }
              : {
                  lastActivityAt: now,
                  firstResponseAt: t.firstResponseAt ?? now,
                  assigneeId: t.assigneeId ?? auth.user.id,
                  ...(['OPEN', 'IN_PROGRESS', 'ESCALATED'].includes(t.status) ? { status: 'AWAITING_CUSTOMER' } : {}),
                },
          });
          await audit.record(
            {
              actorId: auth.user.id,
              action: internal ? 'support.internal_note' : 'support.replied',
              entityType: 'support_ticket',
              entityId: id,
              ...ctx,
            },
            tx,
          );
          return internal ? null : notifyCustomer(tx, t, 'ticket-reply');
        });
        await messaging.dispatch([message]);
        return staffView(id);
      });
    },

    async updateStaff(auth, id, { status, priority, assigneeId, resolution }, ctx) {
      const t = await prisma.supportTicket.findUnique({ where: { id } });
      if (!t) throw new NotFoundError('Ticket not found');
      if (t.userId === auth.user.id) throw new ForbiddenError('You cannot handle your own request');
      const data = {};
      if (status && status !== t.status) {
        if (!STAFF_TRANSITIONS[t.status].includes(status))
          throw new ConflictError(`A ${t.status.toLowerCase()} ticket cannot move to ${status.toLowerCase()}`, 'INVALID_TRANSITION');
        const finalResolution = resolution ?? t.resolution;
        if (t.isComplaint && ['RESOLVED', 'CLOSED'].includes(status) && (finalResolution ?? '').trim().length < 10) {
          throw new ValidationError([
            { location: 'body', path: 'resolution', message: 'Record how the complaint was resolved (at least 10 characters)' },
          ]);
        }
        data.status = status;
        if (['RESOLVED', 'CLOSED'].includes(status)) data.resolvedAt = t.resolvedAt ?? new Date();
        if (status === 'CLOSED') data.closedAt = new Date();
        if (status === 'IN_PROGRESS') data.resolvedAt = null;
      }
      if (priority) data.priority = priority;
      if (resolution !== undefined) data.resolution = resolution;
      if (assigneeId !== undefined) {
        if (assigneeId) {
          const ok = await prisma.userRole.findFirst({
            where: {
              userId: assigneeId,
              user: { status: 'ACTIVE', type: 'STAFF' },
              role: { permissions: { some: { permission: { key: 'support:tickets:manage' } } } },
            },
          });
          if (!ok || assigneeId === t.userId)
            throw new ValidationError([{ location: 'body', path: 'assigneeId', message: 'Choose an active support agent' }]);
        }
        data.assigneeId = assigneeId;
      }
      if (!Object.keys(data).length) return staffView(id);
      data.lastActivityAt = new Date();
      const message = await prisma.$transaction(async (tx) => {
        await tx.supportTicket.update({ where: { id }, data });
        await audit.record(
          {
            actorId: auth.user.id,
            action: 'support.ticket_updated',
            entityType: 'support_ticket',
            entityId: id,
            before: { status: t.status, priority: t.priority, assigneeId: t.assigneeId },
            after: data,
            ...ctx,
          },
          tx,
        );
        return data.status === 'RESOLVED' ? notifyCustomer(tx, t, 'ticket-resolved') : null;
      });
      await messaging.dispatch([message]);
      return staffView(id);
    },

    async agents() {
      const rows = await prisma.user.findMany({
        where: {
          type: 'STAFF',
          status: 'ACTIVE',
          roles: { some: { role: { permissions: { some: { permission: { key: 'support:tickets:manage' } } } } } },
        },
        select: person.select,
        orderBy: { email: 'asc' },
      });
      return rows.map((u) => ({ id: u.id, name: name(u) }));
    },

    /** Volumes, response and resolution times, complaints and per-agent workload over a period. */
    async report({ from, to }) {
      const created = await prisma.supportTicket.findMany({
        where: { createdAt: { gte: from, lt: to } },
        select: {
          status: true,
          category: true,
          priority: true,
          isComplaint: true,
          createdAt: true,
          firstResponseAt: true,
          resolvedAt: true,
          assigneeId: true,
        },
      });
      const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
      const minutes = (a, b) => Math.round((b - a) / 60_000);
      const count = (key) => created.reduce((acc, t) => ({ ...acc, [t[key]]: (acc[t[key]] ?? 0) + 1 }), {});
      const byAgent = await prisma.supportTicket.groupBy({
        by: ['assigneeId'],
        where: { resolvedAt: { gte: from, lt: to }, assigneeId: { not: null } },
        _count: true,
      });
      const agentNames = await prisma.user.findMany({ where: { id: { in: byAgent.map((a) => a.assigneeId) } }, select: person.select });
      return {
        period: { from, to },
        created: created.length,
        byStatus: count('status'),
        byCategory: count('category'),
        byPriority: count('priority'),
        complaints: {
          total: created.filter((t) => t.isComplaint).length,
          open: created.filter((t) => t.isComplaint && !t.resolvedAt).length,
        },
        avgFirstResponseMinutes: avg(created.filter((t) => t.firstResponseAt).map((t) => minutes(t.createdAt, t.firstResponseAt))),
        avgResolutionMinutes: avg(created.filter((t) => t.resolvedAt).map((t) => minutes(t.createdAt, t.resolvedAt))),
        awaitingFirstResponse: created.filter((t) => !t.firstResponseAt && !t.resolvedAt).length,
        resolvedByAgent: byAgent.map((a) => ({ agent: name(agentNames.find((u) => u.id === a.assigneeId)), resolved: a._count })),
      };
    },

    // ── FAQ ────────────────────────────────────────────────────────────────

    async publishedFaqs() {
      return prisma.faq.findMany({
        where: { published: true },
        orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
        select: { id: true, category: true, question: true, answer: true },
      });
    },
    async allFaqs() {
      return prisma.faq.findMany({ orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }] });
    },
    async saveFaq(auth, id, input, ctx) {
      const faq = await prisma.$transaction(async (tx) => {
        const saved = id ? await tx.faq.update({ where: { id }, data: input }) : await tx.faq.create({ data: input });
        await audit.record(
          {
            actorId: auth.user.id,
            action: id ? 'faq.updated' : 'faq.created',
            entityType: 'faq',
            entityId: saved.id,
            after: input,
            ...ctx,
          },
          tx,
        );
        return saved;
      });
      return faq;
    },
    async deleteFaq(auth, id, ctx) {
      await prisma.$transaction(async (tx) => {
        await tx.faq.delete({ where: { id } });
        await audit.record({ actorId: auth.user.id, action: 'faq.deleted', entityType: 'faq', entityId: id, ...ctx }, tx);
      });
    },
  };
}
