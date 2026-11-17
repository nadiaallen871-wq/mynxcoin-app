/**
 * Append-only audit trail. Rows can never be updated or deleted: a database
 * trigger (migration 20261108030025_foundation) rejects UPDATE and DELETE on audit_logs.
 *
 * Pass the transaction client `tx` when the audited change is transactional,
 * so the audit record commits or rolls back together with the change.
 */
const SENSITIVE_KEYS = /pass(word)?|secret|token|otp|cvv|card|pan|recovery/i;

export function scrub(value, depth = 0) {
  if (depth > 6 || value === null || typeof value !== 'object') {
    return typeof value === 'bigint' ? value.toString() : value;
  }
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEYS.test(k) ? '[REDACTED]' : scrub(v, depth + 1)]));
}

export function createAuditService({ prisma }) {
  return {
    async record({ actorId = null, action, entityType, entityId = null, before, after, metadata, ip, userAgent, requestId }, tx = prisma) {
      if (!action || !entityType) throw new Error('audit.record requires action and entityType');
      return tx.auditLog.create({
        data: {
          actorId,
          action,
          entityType,
          entityId: entityId === null ? null : String(entityId),
          before: before === undefined ? undefined : scrub(before),
          after: after === undefined ? undefined : scrub(after),
          metadata: metadata === undefined ? undefined : scrub(metadata),
          ipAddress: ip ?? null,
          userAgent: userAgent ? userAgent.slice(0, 512) : null,
          requestId: requestId ?? null,
        },
      });
    },
  };
}
