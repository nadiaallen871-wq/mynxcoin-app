import { describe, expect, it } from 'vitest';
import { formatMoney } from './format.js';

describe('formatMoney', () => {
  it('formats minor units without float conversion', () => {
    expect(formatMoney('125050', 'USD', { locale: 'en-US' })).toBe('$1,250.50');
  });

  it('handles values beyond Number.MAX_SAFE_INTEGER exactly', () => {
    expect(formatMoney('900719925474099199', 'USD', { locale: 'en-US' })).toBe('$9,007,199,254,740,991.99');
  });

  it('keeps the sign of sub-unit negative amounts', () => {
    expect(formatMoney('-50', 'USD', { locale: 'en-US' })).toBe('-$0.50');
  });

  it('formats zero-decimal currencies', () => {
    expect(formatMoney('1500', 'JPY', { minorUnits: 0, locale: 'en-US' })).toBe('¥1,500');
  });

  it('renders a dash for missing values and rejects malformed input', () => {
    expect(formatMoney(null, 'GHS')).toBe('—');
    expect(() => formatMoney('12.5', 'GHS')).toThrow();
  });
});
