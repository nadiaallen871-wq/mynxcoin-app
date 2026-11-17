/**
 * Sandbox exchange-rate provider. Returns fixed illustrative rates, clearly labelled
 * "sandbox", so conversions can be exercised end to end. They are NOT market rates and
 * must never be shown as such. A live adapter (central bank reference rates or a licensed
 * FX provider) implements the same interface:
 *
 *   name: string
 *   rates({ anchor }) -> [{ currency, rate: '15.5', asOf: Date }]   // value of 1 unit in the anchor currency
 */
const SANDBOX_RATES = { USD: '15.5000', NGN: '0.0098' };

export function createSandboxFxProvider() {
  return {
    name: 'sandbox',
    async rates({ anchor = 'GHS' } = {}) {
      if (anchor !== 'GHS') throw new Error('The sandbox FX provider only quotes against GHS');
      const asOf = new Date();
      return Object.entries(SANDBOX_RATES).map(([currency, rate]) => ({ currency, rate, asOf }));
    },
  };
}
