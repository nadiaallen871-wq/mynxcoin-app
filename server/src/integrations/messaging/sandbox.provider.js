import { randomUUID } from 'node:crypto';

/**
 * Sandbox messaging provider: accepts the message and returns a synthetic ID
 * without contacting any external service. Message bodies stay in the
 * outbound_messages table, which the development outbox viewer reads.
 *
 * Real providers (e.g. an email API or an SMS aggregator) implement the same interface:
 *   send({ channel, recipient, subject, body }) -> Promise<{ providerMessageId }>
 */
export function createSandboxProvider({ logger }) {
  return {
    name: 'sandbox',
    async send({ channel, recipient, template }) {
      const masked = channel === 'EMAIL' ? recipient.replace(/^(.).*(@.*)$/, '$1***$2') : recipient.replace(/\d(?=\d{3})/g, '*');
      logger.info({ channel, recipient: masked, template }, 'sandbox message accepted (not sent)');
      return { providerMessageId: `sandbox-${randomUUID()}` };
    },
  };
}
