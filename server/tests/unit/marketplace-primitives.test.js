import { describe, expect, it } from 'vitest';
import { RoundingMode, accrue, money } from '../../src/utils/money.js';
import { projectInvestment } from '../../src/modules/investments/calculator.js';
import { availabilityOf, slugify } from '../../src/modules/investments/products.service.js';

describe('accrue (simple interest)', () => {
  it('computes amount × rate × days / 365 exactly', () => {
    // GH₵ 10,000 at 25% for 182 days = 1,246.575342… → DOWN → 1,246.57
    expect(accrue(money(1_000_000n, 'GHS'), '0.25', 182, RoundingMode.DOWN).minor).toBe(124_657n);
    expect(accrue(money(1_000_000n, 'GHS'), '0.25', 182, RoundingMode.UP).minor).toBe(124_658n);
    expect(accrue(money(1_000_000n, 'GHS'), '0', 365, RoundingMode.DOWN).minor).toBe(0n);
  });

  it('rejects negative or fractional day counts and malformed rates', () => {
    expect(() => accrue(money(100n, 'GHS'), '0.1', -1, RoundingMode.DOWN)).toThrow();
    expect(() => accrue(money(100n, 'GHS'), '0.1', 1.5, RoundingMode.DOWN)).toThrow();
    expect(() => accrue(money(100n, 'GHS'), '1e-2', 10, RoundingMode.DOWN)).toThrow();
  });
});

describe('projectInvestment', () => {
  it('deducts fees and never overstates the outcome', () => {
    const r = projectInvestment({
      amountMinor: 1_000_000n,
      currency: 'GHS',
      annualRate: '0.25',
      days: 182,
      entryFeeRate: '0.01',
      managementFeeRate: '0.02',
      returnType: 'TARGET',
    });
    expect(r.entryFee.amountMinor).toBe('10000'); // 1% of 10,000.00
    expect(r.invested.amountMinor).toBe('990000');
    expect(r.grossReturn.amountMinor).toBe('123410'); // 9,900 × 25% × 182/365 = 1,234.109… DOWN
    expect(r.managementFee.amountMinor).toBe('9873'); // 9,900 × 2% × 182/365 = 98.728… UP
    expect(r.endValue.amountMinor).toBe(String(990000 + 123410 - 9873));
    expect(BigInt(r.netGain.amountMinor)).toBe(BigInt(r.endValue.amountMinor) - 1_000_000n);
    expect(r.illustrative).toBe(true);
    expect(r.caveats[0]).toMatch(/not a guarantee/);
  });

  it('shows a fee-only illustration for products without a stated rate', () => {
    const r = projectInvestment({
      amountMinor: 100_000n,
      currency: 'GHS',
      annualRate: null,
      days: 365,
      managementFeeRate: '0.015',
      returnType: 'NONE',
    });
    expect(r.grossReturn.amountMinor).toBe('0');
    expect(BigInt(r.netGain.amountMinor)).toBeLessThan(0n);
  });
});

describe('product helpers', () => {
  it('slugifies names', () => {
    expect(slugify('91-Day Treasury Bill (Series 3)')).toBe('91-day-treasury-bill-series-3');
    expect(slugify('Côte d’Ivoire Bond')).toBe('cote-d-ivoire-bond');
  });

  it('derives availability from status and subscription window', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    const base = { status: 'PUBLISHED', subscriptionOpensAt: null, subscriptionClosesAt: null };
    expect(availabilityOf(base, now)).toBe('OPEN');
    expect(availabilityOf({ ...base, subscriptionOpensAt: new Date('2026-07-01') }, now)).toBe('UPCOMING');
    expect(availabilityOf({ ...base, subscriptionClosesAt: new Date('2026-05-01') }, now)).toBe('CLOSED');
    expect(availabilityOf({ ...base, status: 'CLOSED' }, now)).toBe('CLOSED');
    expect(availabilityOf({ ...base, status: 'DRAFT' }, now)).toBe('UNAVAILABLE');
  });
});
