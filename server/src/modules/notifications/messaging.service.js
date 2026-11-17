import { MANDATORY_EMAIL_CATEGORIES, TEMPLATE_META, inAppText, renderTemplate } from './templates.js';

export const DELIVER_MESSAGE_JOB = 'deliver-message';
const MAX_ATTEMPTS = 10;

/**
 * Transactional outbox:
 *  1. `queue(tx, …)` writes an OutboundMessage inside the caller's transaction,
 *     so a message exists if and only if the business change committed.
 *  2. After commit the caller passes the rows to `dispatch(rows)`, which enqueues
 *     a delivery job (idempotent by message ID) or, when queues are disabled
 *     (tests, single-process dev), delivers inline.
 *  3. `deliver(id)` is idempotent: already-sent messages are skipped.
 */
export function createMessagingService({ prisma, env, logger, providers, queue: jobQueue = null }) {
  // Staging and production never keep access-granting links or codes after delivery.
  const redactAfterSend = ['staging', 'production'].includes(env.NODE_ENV);

  async function deliver(id) {
    const message = await prisma.outboundMessage.findUnique({ where: { id } });
    if (!message || message.status === 'SENT') return message;
    const provider = providers[message.channel];
    try {
      const { providerMessageId } = await provider.send({
        channel: message.channel,
        recipient: message.recipient,
        subject: message.subject,
        body: message.body,
        template: message.template,
      });
      return await prisma.outboundMessage.update({
        where: { id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          provider: provider.name,
          providerMessageId,
          attempts: { increment: 1 },
          lastError: null,
          ...(message.containsSecret && redactAfterSend ? { body: '[redacted after delivery]' } : {}),
        },
      });
    } catch (err) {
      await prisma.outboundMessage.update({
        where: { id },
        // After the last attempt the message is marked FAILED so it shows up for follow-up instead of retrying forever.
        data: {
          attempts: { increment: 1 },
          lastError: String(err.message).slice(0, 500),
          status: message.attempts + 1 >= MAX_ATTEMPTS ? 'FAILED' : 'QUEUED',
        },
      });
      throw err;
    }
  }

  return {
    /**
     * Writes the user's notifications for one event inside the caller's transaction:
     * the in-app entry, the email and, if the user opted in, a short SMS. Preferences
     * apply per category; security and account emails are always sent. Returns the
     * outbox row(s) to pass to `dispatch`, or null when every channel is switched off.
     */
    async queue(tx, { userId = null, channel = 'EMAIL', recipient, template, vars = {} }) {
      const { subject, body, containsSecret } = renderTemplate(template, vars);
      const create = (data) => tx.outboundMessage.create({ data: { userId, template, ...data }, select: { id: true } });
      const meta = userId && channel === 'EMAIL' ? TEMPLATE_META[template] : null;
      if (!meta) return create({ channel, recipient, subject, body, containsSecret });

      const pref = await tx.notificationPreference.findUnique({ where: { userId_category: { userId, category: meta.category } } });
      if (pref?.inApp ?? true) {
        await tx.notification.create({
          data: { userId, category: meta.category, template, title: subject, body: inAppText(body), link: meta.link ?? null },
        });
      }
      const rows = [];
      if (MANDATORY_EMAIL_CATEGORIES.has(meta.category) || (pref?.email ?? true)) {
        rows.push(await create({ channel: 'EMAIL', recipient, subject, body, containsSecret }));
      }
      if (pref?.sms) {
        const user = await tx.user.findUnique({ where: { id: userId }, select: { phone: true, phoneVerifiedAt: true } });
        if (user?.phone && user.phoneVerifiedAt) {
          rows.push(
            await create({
              channel: 'SMS',
              recipient: user.phone,
              subject: null,
              body: `Mynx: ${subject}. Sign in for details.`,
              containsSecret: false,
            }),
          );
        }
      }
      if (!rows.length) return null;
      const [first, ...also] = rows;
      return also.length ? { ...first, also } : first;
    },

    /** Call after the transaction commits. Delivery failures are logged, never thrown to the caller. */
    async dispatch(rows) {
      for (const row of rows.filter(Boolean).flatMap((r) => [r, ...(r.also ?? [])])) {
        try {
          if (jobQueue) await jobQueue.add(DELIVER_MESSAGE_JOB, { messageId: row.id }, { jobId: `msg__${row.id}` });
          else await deliver(row.id);
        } catch (err) {
          logger.error({ err, messageId: row.id }, 'message dispatch failed; it remains QUEUED for retry');
        }
      }
    },

    deliver,

    /** Worker sweep: re-dispatch messages left QUEUED (e.g. Redis was down at commit time). */
    async redispatchStale({ olderThanMs = 60_000, limit = 100 } = {}) {
      const stale = await prisma.outboundMessage.findMany({
        where: { status: 'QUEUED', createdAt: { lt: new Date(Date.now() - olderThanMs) }, attempts: { lt: MAX_ATTEMPTS } },
        select: { id: true },
        take: limit,
      });
      await this.dispatch(stale);
      return stale.length;
    },
  };
}
