import { RoundingMode, accrue, money, subtract, add, multiplyByRate, toJSON } from '../../utils/money.js';

/**
 * Illustrative projection for a single, held-to-term investment. Exact BigInt
 * arithmetic throughout, rounded down at each step (in the investor's
 * disfavour) so the illustration never overstates.
 *
 *   entry fee        = amount × entryFeeRate
 *   invested         = amount − entry fee
 *   gross return     = invested × annualRate × days / 365      (simple, non-compounding)
 *   management fee   = invested × managementFeeRate × days / 365 (rounded up)
 *   value at end     = invested + gross return − management fee
 *
 * Results are before tax and assume the issuer meets its obligations. For TARGET
 * products the rate is not guaranteed. These caveats travel with the response.
 */
export function projectInvestment({ amountMinor, currency, annualRate, days, entryFeeRate = '0', managementFeeRate = '0', returnType }) {
  const amount = money(amountMinor, currency);
  const entryFee = multiplyByRate(amount, entryFeeRate, RoundingMode.UP);
  const invested = subtract(amount, entryFee);
  const grossReturn = annualRate ? accrue(invested, annualRate, days, RoundingMode.DOWN) : money(0n, currency);
  const managementFee = accrue(invested, managementFeeRate, days, RoundingMode.UP);
  const endValue = subtract(add(invested, grossReturn), managementFee);
  const netGain = subtract(endValue, amount);

  return {
    amount: toJSON(amount),
    entryFee: toJSON(entryFee),
    invested: toJSON(invested),
    grossReturn: toJSON(grossReturn),
    managementFee: toJSON(managementFee),
    endValue: toJSON(endValue),
    netGain: toJSON(netGain),
    days,
    basis: 'simple interest, actual/365, before tax',
    illustrative: true,
    caveats: [
      returnType === 'FIXED'
        ? 'The rate is fixed by contract, but you could still lose money if the issuer fails to pay.'
        : returnType === 'TARGET'
          ? 'The rate is a target, not a guarantee. Actual returns may be lower, and you may lose money.'
          : 'This product has no stated rate. The illustration shows fees only, and actual returns may be negative.',
      'Figures are before tax and assume the investment is held for the full period.',
      'Past performance is not a reliable indicator of future results.',
    ],
  };
}
