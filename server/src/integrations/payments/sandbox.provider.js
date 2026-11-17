import { randomUUID } from 'node:crypto';
import { hmacSha512, safeEqual } from '../../utils/crypto.js';

export const SANDBOX_SIGNATURE_HEADER = 'x-sandbox-signature';

/**
 * Sandbox payment provider. It behaves like a hosted-checkout provider:
 *  - initializeCollection returns a checkout URL (our /sandbox/checkout page).
 *  - The "provider side" lives in `sandbox_provider_transactions`, never in our payments table.
 *  - Outcomes are delivered as HMAC-SHA512-signed webhooks, and our code must verify the
 *    signature and then re-query the provider (verifyCollection), exactly as with a real provider.
 *  - Fee model (simulated): 1.95% of the amount, capped at GH₵ 20.00.
 *  - Payouts succeed immediately, unless the account number ends in "0000" (simulated failure).
 *
 * No money moves. The sandbox exists so every code path is exercised before real providers are connected.
 */
export function createSandboxPaymentProvider({ prisma, appBaseUrl, webhookSecret }) {
  const sign = (raw) => hmacSha512(webhookSecret, raw);
  const fee = (amountMinor) => {
    const f = (amountMinor * 195n) / 10_000n;
    return f > 2_000n ? 2_000n : f;
  };
  const toStatus = (s) => ({ SUCCESS: 'SUCCEEDED', FAILED: 'FAILED', PENDING: 'PENDING' })[s] ?? 'PENDING';

  return {
    name: 'sandbox',

    async initializeCollection({ reference, amountMinor, currency }) {
      await prisma.sandboxProviderTransaction.create({ data: { reference, kind: 'COLLECTION', status: 'PENDING', amountMinor, currency } });
      return { checkoutUrl: `${appBaseUrl}/sandbox/checkout/${reference}`, providerTransactionId: `sbx_${reference}` };
    },

    async verifyCollection(reference) {
      const t = await prisma.sandboxProviderTransaction.findUnique({ where: { reference } });
      if (!t) return { status: 'FAILED', failureReason: 'Unknown reference at provider' };
      return {
        status: toStatus(t.status),
        amountMinor: t.amountMinor,
        currency: t.currency,
        feeMinor: t.feeMinor,
        providerTransactionId: `sbx_${reference}`,
      };
    },

    async initiatePayout({ reference, amountMinor, currency, destination }) {
      const failed = String(destination.accountNumber).endsWith('0000');
      await prisma.sandboxProviderTransaction.create({
        data: { reference, kind: 'PAYOUT', status: failed ? 'FAILED' : 'SUCCESS', amountMinor, currency },
      });
      return failed
        ? {
            status: 'FAILED',
            providerTransactionId: `sbx_${reference}`,
            failureReason: 'Destination account rejected the transfer (sandbox)',
          }
        : { status: 'SUCCEEDED', providerTransactionId: `sbx_${reference}` };
    },

    async verifyPayout(reference) {
      const t = await prisma.sandboxProviderTransaction.findUnique({ where: { reference } });
      return t
        ? { status: toStatus(t.status), providerTransactionId: `sbx_${reference}` }
        : { status: 'FAILED', failureReason: 'Unknown reference at provider' };
    },

    /** Verifies the signature and extracts the identifying fields. Never trusts amounts or statuses from the body. */
    parseWebhook({ rawBody, headers }) {
      const signature = headers[SANDBOX_SIGNATURE_HEADER];
      if (typeof signature !== 'string' || !rawBody || !safeEqual(sign(rawBody), signature)) return { valid: false };
      const body = JSON.parse(rawBody.toString('utf8'));
      const type = body.event?.startsWith('transfer.') ? 'payout' : 'collection';
      return {
        valid: true,
        eventId: String(body.id),
        eventType: String(body.event),
        reference: body.data?.reference ?? null,
        type,
        payload: body,
      };
    },

    // ── Sandbox-only: plays the part of the customer completing (or abandoning) the hosted checkout ──
    async simulateCheckout(reference, outcome) {
      const t = await prisma.sandboxProviderTransaction.findUnique({ where: { reference } });
      if (!t || t.kind !== 'COLLECTION') throw new Error('Unknown sandbox checkout');
      if (t.status !== 'PENDING') return null;
      const success = outcome === 'success';
      await prisma.sandboxProviderTransaction.update({
        where: { reference },
        data: { status: success ? 'SUCCESS' : 'FAILED', feeMinor: success ? fee(t.amountMinor) : 0n },
      });
      const rawBody = Buffer.from(
        JSON.stringify({ id: randomUUID(), event: success ? 'charge.success' : 'charge.failed', data: { reference } }),
      );
      return { rawBody, headers: { [SANDBOX_SIGNATURE_HEADER]: sign(rawBody) } };
    },

    _sign: sign,
  };
}
