import { describe, expect, it } from 'vitest';
import { createPdf, textWidth, toCsv } from '../../src/utils/pdf.js';
import { formatAmount } from '../../src/modules/statements/statements.service.js';

describe('createPdf', () => {
  it('writes a valid cross-reference table and breaks pages', () => {
    const pdf = createPdf({ title: 'Test (statement)', footer: 'Test' });
    pdf.heading('Hello');
    for (let i = 0; i < 120; i++) pdf.row([{ text: `Row ${i}` }, { text: '1,000.00', x: 545, align: 'right' }]);
    const text = pdf.build().toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    const pages = Number(/\/Count (\d+)/.exec(text)[1]);
    expect(pages).toBeGreaterThan(1);
    expect(text).toContain(`Page ${pages} of ${pages}`);
    // Every xref offset points at the start of its object.
    const xref = Number(/startxref\n(\d+)/.exec(text)[1]);
    const entries = text
      .slice(xref)
      .split('\n')
      .slice(3)
      .filter((l) => / n $/.test(l));
    entries.forEach((line, i) => expect(text.slice(Number(line.slice(0, 10))).startsWith(`${i + 1} 0 obj\n`)).toBe(true));
    // Parentheses in text are escaped so they cannot break out of a string.
    expect(text).toContain('/Title (Test \\(statement\\))');
  });

  it('replaces characters outside WinAnsi instead of corrupting the file', () => {
    const text = createPdf({ title: 't' }).text('Paid ₵10 — thanks').build().toString('latin1');
    expect(text).toContain('Paid ?10 \x97 thanks');
  });

  it('measures right-aligned numbers consistently', () => {
    expect(textWidth('1,000.00', 10)).toBeCloseTo(((556 * 6 + 278 * 2) / 1000) * 10);
  });
});

describe('toCsv', () => {
  it('quotes separators and neutralises spreadsheet formulas but keeps negative numbers', () => {
    const csv = toCsv([['a,b', 'say "hi"', '=HYPERLINK("x")', '+1+2', '-12.50', '@SUM(A1)']]);
    expect(csv).toBe('"a,b","say ""hi""","\'=HYPERLINK(""x"")",\'+1+2,-12.50,\'@SUM(A1)\r\n');
  });
});

describe('formatAmount', () => {
  it('formats minor units with grouping and sign', () => {
    expect(formatAmount(123456789n, 'GHS')).toBe('GHS 1,234,567.89');
    expect(formatAmount(-5n, 'GHS')).toBe('-GHS 0.05');
  });
});
