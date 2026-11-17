import { Prisma } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../utils/errors.js';
import { TEMPLATES, TEMPLATE_META } from '../notifications/templates.js';
import { toCsv } from '../../utils/pdf.js';
import { money, toDecimalString } from '../../utils/money.js';

const EXPORT_LIMIT = 10_000;
const isoDay = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const dec = (minor, currency = 'GHS') => toDecimalString(money(BigInt(minor ?? 0), currency));
const actorName = (a) => (a ? (a.profile ? `${a.profile.firstName} ${a.profile.lastName}` : a.email) : 'System');
const actorSelect = { select: { email: true, profile: { select: { firstName: true, lastName: true } } } };

export function maskRecipient(r) {
  if (!r) return r;
  if (r.includes('@')) {
    const [local, domain] = r.split('@');
    return `${local.slice(0, 1)}***@${domain}`;
  }
  return `${r.slice(0, 4)}****${r.slice(-3)}`;
}

/**
 * Audit log viewer, administrative reports and the message delivery log.
 * Every export is itself audited.
 */
export function createRecordsService({ prisma, audit, messaging }) {
  // ── Audit ────────────────────────────────────────────────────────────────

  async function auditWhere({ actor, action, entityType, entityId, from, to }) {
    const where = {};
    if (action) where.action = { startsWith: action };
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;
    if (from || to) where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) };
    if (actor) {
      const ids = await prisma.user.findMany({ where: { email: { contains: actor.toLowerCase() } }, select: { id: true }, take: 50 });
      where.actorId = { in: ids.map((u) => u.id) };
    }
    return where;
  }

  const serializeAudit = (r, full = false) => ({
    id: r.id.toString(),
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    actor: actorName(r.actor),
    actorId: r.actorId,
    ipAddress: r.ipAddress,
    requestId: r.requestId,
    createdAt: r.createdAt,
    ...(full ? { before: r.before, after: r.after, metadata: r.metadata, userAgent: r.userAgent } : {}),
  });

  // ── Reports ──────────────────────────────────────────────────────────────

  const REPORTS = {
    async 'financial-summary'({ from, to, currency }) {
      const daily = (sql) => prisma.$queryRaw(sql);
      const [dep, wd, inv, mat, rew] = await Promise.all([
        daily(
          Prisma.sql`SELECT completed_at::date AS day, SUM(amount_minor)::bigint AS v FROM deposits WHERE status = 'SUCCEEDED' AND currency = ${currency} AND completed_at >= ${from} AND completed_at < ${to} GROUP BY 1`,
        ),
        daily(
          Prisma.sql`SELECT completed_at::date AS day, SUM(amount_minor)::bigint AS v, SUM(fee_minor)::bigint AS f FROM withdrawals WHERE status = 'COMPLETED' AND currency = ${currency} AND completed_at >= ${from} AND completed_at < ${to} GROUP BY 1`,
        ),
        daily(
          Prisma.sql`SELECT confirmed_at::date AS day, SUM(amount_minor)::bigint AS v, SUM(fee_minor)::bigint AS f FROM investment_orders WHERE confirm_entry_id IS NOT NULL AND currency = ${currency} AND confirmed_at >= ${from} AND confirmed_at < ${to} GROUP BY 1`,
        ),
        daily(
          Prisma.sql`SELECT matured_at::date AS day, SUM(proceeds_minor)::bigint AS v, SUM(management_fee_minor)::bigint AS f FROM investment_holdings WHERE status = 'MATURED' AND currency = ${currency} AND matured_at >= ${from} AND matured_at < ${to} GROUP BY 1`,
        ),
        daily(
          Prisma.sql`SELECT created_at::date AS day, SUM(amount_minor)::bigint AS v FROM referral_rewards WHERE currency = ${currency} AND created_at >= ${from} AND created_at < ${to} GROUP BY 1`,
        ),
      ]);
      const days = new Map();
      const add = (rows, col, field = 'v') =>
        rows.forEach((r) => {
          const k = isoDay(r.day);
          const row = days.get(k) ?? {
            date: k,
            deposits: 0n,
            withdrawals: 0n,
            invested: 0n,
            maturities: 0n,
            entryFees: 0n,
            managementFees: 0n,
            withdrawalFees: 0n,
            referralRewards: 0n,
          };
          row[col] += BigInt(r[field] ?? 0);
          days.set(k, row);
        });
      add(dep, 'deposits');
      add(wd, 'withdrawals');
      add(wd, 'withdrawalFees', 'f');
      add(inv, 'invested');
      add(inv, 'entryFees', 'f');
      add(mat, 'maturities');
      add(mat, 'managementFees', 'f');
      add(rew, 'referralRewards');
      const cols = [
        'deposits',
        'withdrawals',
        'invested',
        'maturities',
        'entryFees',
        'managementFees',
        'withdrawalFees',
        'referralRewards',
      ];
      const rows = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
      const totals = Object.fromEntries(cols.map((c) => [c, rows.reduce((a, r) => a + r[c], 0n)]));
      return {
        columns: [
          { key: 'date', label: 'Date' },
          ...cols.map((c) => ({ key: c, label: c.replace(/([A-Z])/g, ' $1').replace(/^./, (x) => x.toUpperCase()), money: true })),
        ],
        rows: rows.map((r) => ({ ...r, ...Object.fromEntries(cols.map((c) => [c, dec(r[c], currency)])) })),
        totals: Object.fromEntries(cols.map((c) => [c, dec(totals[c], currency)])),
      };
    },

    async investors({ from, to }) {
      const [reg, kyc] = await Promise.all([
        prisma.$queryRaw`SELECT created_at::date AS day, COUNT(*)::int AS n FROM users WHERE type <> 'STAFF' AND created_at >= ${from} AND created_at < ${to} GROUP BY 1`,
        prisma.$queryRaw`SELECT kyc_verified_at::date AS day, COUNT(*)::int AS n FROM investor_profiles WHERE kyc_verified_at >= ${from} AND kyc_verified_at < ${to} GROUP BY 1`,
      ]);
      const days = new Map();
      const add = (rows, col) =>
        rows.forEach((r) => {
          const k = isoDay(r.day);
          const row = days.get(k) ?? { date: k, registrations: 0, verified: 0 };
          row[col] += r.n;
          days.set(k, row);
        });
      add(reg, 'registrations');
      add(kyc, 'verified');
      const rows = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
      return {
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'registrations', label: 'New investors' },
          { key: 'verified', label: 'Identity verified' },
        ],
        rows,
        totals: { registrations: rows.reduce((a, r) => a + r.registrations, 0), verified: rows.reduce((a, r) => a + r.verified, 0) },
      };
    },

    async investments({ from, to, currency }) {
      const rows = await prisma.$queryRaw`
        SELECT p.name AS product,
          COUNT(o.id) FILTER (WHERE o.confirmed_at >= ${from} AND o.confirmed_at < ${to})::int AS confirmed,
          COALESCE(SUM(o.amount_minor) FILTER (WHERE o.confirmed_at >= ${from} AND o.confirmed_at < ${to}), 0)::bigint AS confirmed_amount,
          (SELECT COALESCE(SUM(h.principal_minor), 0) FROM investment_holdings h WHERE h.product_id = p.id AND h.status <> 'MATURED')::bigint AS active_principal,
          (SELECT COUNT(DISTINCT h.user_id) FROM investment_holdings h WHERE h.product_id = p.id AND h.status <> 'MATURED')::int AS holders
        FROM investment_products p
        LEFT JOIN investment_orders o ON o.product_id = p.id AND o.confirm_entry_id IS NOT NULL
        WHERE p.currency = ${currency}
        GROUP BY p.id, p.name ORDER BY p.name`;
      return {
        columns: [
          { key: 'product', label: 'Product' },
          { key: 'confirmed', label: 'Orders confirmed' },
          { key: 'confirmedAmount', label: 'Amount confirmed', money: true },
          { key: 'activePrincipal', label: 'Active principal (now)', money: true },
          { key: 'holders', label: 'Investors (now)' },
        ],
        rows: rows.map((r) => ({
          product: r.product,
          confirmed: r.confirmed,
          confirmedAmount: dec(r.confirmed_amount, currency),
          activePrincipal: dec(r.active_principal, currency),
          holders: r.holders,
        })),
      };
    },

    async transactions({ from, to }) {
      const rows = await prisma.$queryRaw`
        SELECT e.entry_number, e.type, e.description, e.reference_type, e.reference_id, e.posted_at,
          SUM(l.amount_minor) FILTER (WHERE l.amount_minor > 0)::bigint AS debit, MIN(l.currency) AS currency
        FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id
        WHERE e.posted_at >= ${from} AND e.posted_at < ${to}
        GROUP BY e.id ORDER BY e.entry_number LIMIT ${EXPORT_LIMIT}`;
      return {
        columns: [
          { key: 'entry', label: 'Entry' },
          { key: 'postedAt', label: 'Posted at (UTC)' },
          { key: 'type', label: 'Type' },
          { key: 'description', label: 'Description' },
          { key: 'reference', label: 'Reference' },
          { key: 'amount', label: 'Amount', money: true },
          { key: 'currency', label: 'Currency' },
        ],
        rows: rows.map((r) => ({
          entry: r.entry_number.toString(),
          postedAt: r.posted_at.toISOString(),
          type: r.type,
          description: r.description,
          reference: r.reference_type ? `${r.reference_type}:${r.reference_id}` : '',
          amount: dec(r.debit, r.currency),
          currency: r.currency,
        })),
        truncated: rows.length >= EXPORT_LIMIT,
      };
    },
  };

  return {
    async listAudit(filters) {
      const { page = 1, pageSize = 50 } = filters;
      const where = await auditWhere(filters);
      const [total, rows] = await prisma.$transaction([
        prisma.auditLog.count({ where }),
        prisma.auditLog.findMany({
          where,
          include: { actor: actorSelect },
          orderBy: { id: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      return { data: rows.map((r) => serializeAudit(r)), meta: { page, pageSize, total } };
    },

    async getAudit(id) {
      const r = await prisma.auditLog.findUnique({ where: { id: BigInt(id) }, include: { actor: actorSelect } });
      if (!r) throw new NotFoundError('Audit entry not found');
      return serializeAudit(r, true);
    },

    async exportAudit(auth, filters, ctx) {
      const where = await auditWhere(filters);
      const rows = await prisma.auditLog.findMany({ where, include: { actor: actorSelect }, orderBy: { id: 'asc' }, take: EXPORT_LIMIT });
      await audit.record({
        actorId: auth.user.id,
        action: 'audit.exported',
        entityType: 'audit_log',
        metadata: { filters, rows: rows.length },
        ...ctx,
      });
      return toCsv([
        ['ID', 'Time (UTC)', 'Actor', 'Action', 'Entity type', 'Entity ID', 'IP address', 'Request ID', 'Before', 'After', 'Metadata'],
        ...rows.map((r) => [
          r.id.toString(),
          r.createdAt.toISOString(),
          actorName(r.actor),
          r.action,
          r.entityType,
          r.entityId,
          r.ipAddress,
          r.requestId,
          r.before ? JSON.stringify(r.before) : '',
          r.after ? JSON.stringify(r.after) : '',
          r.metadata ? JSON.stringify(r.metadata) : '',
        ]),
      ]);
    },

    REPORT_KINDS: Object.keys(REPORTS),

    async report(auth, kind, { from, to, currency = 'GHS', format = 'json' }, ctx) {
      const result = await REPORTS[kind]({ from, to, currency });
      if (format !== 'csv') return result;
      await audit.record({
        actorId: auth.user.id,
        action: 'report.exported',
        entityType: 'report',
        entityId: kind,
        metadata: { from, to, currency },
        ...ctx,
      });
      const header = result.columns.map((c) => c.label);
      const body = result.rows.map((r) => result.columns.map((c) => r[c.key]));
      const totals = result.totals ? [['Total', ...result.columns.slice(1).map((c) => result.totals[c.key] ?? '')]] : [];
      return toCsv([header, ...body, ...totals]);
    },

    // ── Messages ─────────────────────────────────────────────────────────────

    async listMessages({ status, channel, template, page = 1, pageSize = 50 }) {
      const where = { ...(status ? { status } : {}), ...(channel ? { channel } : {}), ...(template ? { template } : {}) };
      const [total, rows, byStatus] = await prisma.$transaction([
        prisma.outboundMessage.count({ where }),
        prisma.outboundMessage.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
        prisma.outboundMessage.groupBy({ by: ['status'], _count: true, orderBy: { status: 'asc' } }),
      ]);
      return {
        // Bodies are never shown: they can contain sign-in links or codes.
        data: rows.map((m) => ({
          id: m.id,
          channel: m.channel,
          template: m.template,
          recipient: maskRecipient(m.recipient),
          subject: m.subject,
          status: m.status,
          attempts: m.attempts,
          lastError: m.lastError,
          provider: m.provider,
          createdAt: m.createdAt,
          sentAt: m.sentAt,
        })),
        meta: { page, pageSize, total, byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])) },
      };
    },

    async retryMessage(auth, id, ctx) {
      const m = await prisma.outboundMessage.findUnique({ where: { id } });
      if (!m) throw new NotFoundError('Message not found');
      if (m.status !== 'FAILED') throw new ConflictError('Only failed messages can be retried', 'NOT_FAILED');
      if (m.containsSecret)
        throw new ConflictError(
          'Messages with sign-in links or codes are not re-sent; the person can request a new one',
          'CONTAINS_SECRET',
        );
      await prisma.outboundMessage.update({ where: { id }, data: { status: 'QUEUED', attempts: 0 } });
      await audit.record({ actorId: auth.user.id, action: 'message.retried', entityType: 'outbound_message', entityId: id, ...ctx });
      await messaging.dispatch([{ id }]);
      return (await this.listMessages({ page: 1, pageSize: 1, template: m.template })).data.find((x) => x.id === id) ?? { id };
    },

    templates() {
      return Object.keys(TEMPLATES).map((key) => ({
        key,
        category: TEMPLATE_META[key]?.category ?? 'TRANSACTIONAL',
        inApp: Boolean(TEMPLATE_META[key]),
        optOut: Boolean(TEMPLATE_META[key]) && !['SECURITY', 'ACCOUNT'].includes(TEMPLATE_META[key].category),
      }));
    },
  };
}
