import { hmacSha512, safeEqual } from '../../utils/crypto.js';

const BASE_URL = 'https://api.paystack.co';

/**
 * Paystack adapter (collections). It follows Paystack's documented API:
 *  - POST /transaction/initialize → authorization_url (hosted checkout)
 *  - GET  /transaction/verify/:reference → status, amount (minor units), currency, fees
 *  - Webhooks are signed with HMAC-SHA512 of the raw body using the secret key (x-paystack-signature).
 *
 * Status: written and unit-tested against recorded response shapes with a mocked `fetch`.
 * Not yet exercised against Paystack's test environment, because no credentials are configured.
 * Payouts (Transfers) need transfer-recipient management and are not implemented: initiatePayout
 * fails clearly rather than pretending. See documentation/payments.md.
 */
export function createPaystackProvider({ secretKey, fetchImpl = fetch, timeoutMs = 15_000 }) {
  async function call(method, path, body) {
    const res = await fetchImpl(`${BASE_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.status) {
      const err = new Error(`Paystack ${method} ${path} failed: ${json?.message ?? res.status}`);
      err.providerStatus = res.status;
      throw err;
    }
    return json.data;
  }

  const mapStatus = (s) => (s === 'success' ? 'SUCCEEDED' : ['failed', 'abandoned', 'reversed'].includes(s) ? 'FAILED' : 'PENDING');

  return {
    name: 'paystack',

    async initializeCollection({ reference, amountMinor, currency, email, callbackUrl }) {
      const data = await call('POST', '/transaction/initialize', {
        reference,
        amount: amountMinor.toString(),
        currency,
        email,
        callback_url: callbackUrl,
      });
      return { checkoutUrl: data.authorization_url, providerTransactionId: null };
    },

    async verifyCollection(reference) {
      const data = await call('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
      return {
        status: mapStatus(data.status),
        amountMinor: BigInt(data.amount),
        currency: data.currency,
        feeMinor: BigInt(data.fees ?? 0),
        providerTransactionId: String(data.id),
        failureReason: data.gateway_response ?? null,
      };
    },

    async initiatePayout() {
      return { status: 'FAILED', failureReason: 'Paystack transfers are not configured on this platform yet' };
    },

    async verifyPayout() {
      return { status: 'FAILED', failureReason: 'Paystack transfers are not configured on this platform yet' };
    },

    parseWebhook({ rawBody, headers }) {
      const signature = headers['x-paystack-signature'];
      if (typeof signature !== 'string' || !rawBody || !safeEqual(hmacSha512(secretKey, rawBody), signature)) return { valid: false };
      const body = JSON.parse(rawBody.toString('utf8'));
      const type = String(body.event ?? '').startsWith('transfer.') ? 'payout' : 'collection';
      return {
        valid: true,
        eventId: `${body.event}:${body.data?.id ?? body.data?.reference}`,
        eventType: String(body.event),
        reference: body.data?.reference ?? null,
        type,
        payload: body,
      };
    },
  };
}
