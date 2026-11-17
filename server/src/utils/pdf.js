/**
 * Minimal PDF 1.4 writer for statements, receipts and confirmations.
 *
 * Text only, A4 portrait, the PDF base fonts (Helvetica and Helvetica-Bold, so
 * nothing is embedded), automatic page breaks and "Page x of y" footers.
 * No dependency: generation is deterministic and easy to audit. Text is encoded
 * as WinAnsi. Characters outside it are replaced with "?", so callers format
 * money as "GHS 1,000.00" rather than with the cedi sign.
 */

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 50;
const BOTTOM = 60;

// Helvetica advance widths (1/1000 em) for common characters; anything else uses 556.
const WIDTHS = (() => {
  const w = {};
  const set = (chars, width) => {
    for (const c of chars) w[c] = width;
  };
  set(" ,.:;!|il'", 278);
  set('0123456789$#?_', 556);
  set('abcdeghnopqu', 556);
  set('fjrt', 278);
  set('ksvxyz', 500);
  set('m', 833);
  set('w', 722);
  set('ABEKPSVXY', 667);
  set('CDHNRUw', 722);
  set('FTZ', 611);
  set('GOQ', 778);
  set('J', 500);
  set('L', 556);
  set('M', 833);
  set('W', 944);
  set('I', 278);
  set('-()/', 333);
  set('%', 889);
  set('&', 667);
  set('+=<>', 584);
  set('"', 355);
  set('@', 1015);
  set('*', 389);
  return w;
})();

const WIN_ANSI = { '—': 0x97, '–': 0x96, '•': 0x95, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '…': 0x85, '€': 0x80 };

function encode(text) {
  let out = '';
  for (const ch of String(text)) {
    let code = WIN_ANSI[ch] ?? ch.codePointAt(0);
    if (code > 255 || (code < 32 && code !== 9)) code = 63; // "?"
    const c = String.fromCharCode(code);
    out += c === '(' || c === ')' || c === '\\' ? `\\${c}` : c;
  }
  return out;
}

export function textWidth(text, size, bold = false) {
  let units = 0;
  for (const ch of String(text)) units += WIDTHS[ch] ?? 556;
  return (units / 1000) * size * (bold ? 1.05 : 1);
}

function wrap(text, size, bold, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && textWidth(next, size, bold) > maxWidth) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Usage:
 *   const pdf = createPdf({ title: 'Account statement' });
 *   pdf.heading('Account statement'); pdf.text('Period …'); pdf.row([{ text: 'Date' }, { text: 'Amount', x: 545, align: 'right' }]);
 *   const buffer = pdf.build();
 */
export function createPdf({ title, author = 'Mynx', footer = '' }) {
  const pages = [];
  let ops = null;
  let y = 0;

  const newPage = () => {
    ops = [];
    pages.push(ops);
    y = PAGE_H - MARGIN;
  };
  const ensure = (height) => {
    if (!ops || y - height < BOTTOM) newPage();
  };
  const put = (text, x, size, bold, gray = 0) => {
    ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${gray} g ${x.toFixed(2)} ${y.toFixed(2)} Td (${encode(text)}) Tj ET`);
  };

  const api = {
    width: PAGE_W,
    left: MARGIN,
    right: PAGE_W - MARGIN,

    heading(text, size = 18) {
      ensure(size + 10);
      y -= size;
      put(text, MARGIN, size, true);
      y -= 10;
      return api;
    },

    /** Wrapped paragraph. `gray` is 0 (black) to 1 (white). */
    text(text, { size = 10, bold = false, gray = 0, indent = 0 } = {}) {
      for (const line of wrap(text, size, bold, PAGE_W - 2 * MARGIN - indent)) {
        ensure(size + 4);
        y -= size + 3;
        put(line, MARGIN + indent, size, bold, gray);
      }
      return api;
    },

    /** One line of cells at fixed x positions. `align: 'right'` right-aligns the cell at its x. */
    row(cells, { size = 9, bold = false, gray = 0 } = {}) {
      ensure(size + 5);
      y -= size + 4;
      for (const cell of cells) {
        const cellBold = cell.bold ?? bold;
        const x = cell.align === 'right' ? cell.x - textWidth(cell.text, size, cellBold) : (cell.x ?? MARGIN);
        put(cell.text ?? '', x, size, cellBold, cell.gray ?? gray);
      }
      return api;
    },

    /** Label/value pairs, e.g. receipt details. */
    pairs(items, { size = 10, labelWidth = 170 } = {}) {
      for (const [label, value] of items) {
        ensure(size + 5);
        y -= size + 5;
        put(label, MARGIN, size, false, 0.4);
        put(String(value ?? '—'), MARGIN + labelWidth, size, true);
      }
      return api;
    },

    rule() {
      ensure(10);
      y -= 6;
      ops.push(`0.8 G 0.5 w ${MARGIN} ${y.toFixed(2)} m ${(PAGE_W - MARGIN).toFixed(2)} ${y.toFixed(2)} l S`);
      y -= 4;
      return api;
    },

    space(height = 10) {
      ensure(height);
      y -= height;
      return api;
    },

    build() {
      if (!pages.length) newPage();
      const objects = [];
      const add = (body) => objects.push(body); // returns the 1-based object number
      const catalog = add(null);
      const pagesObj = add(null);
      const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
      const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
      const info = add(`<< /Title (${encode(title)}) /Author (${encode(author)}) /Producer (Mynx statements) >>`);
      const kids = [];
      pages.forEach((pageOps, i) => {
        const foot = `${footer ? `${footer}  •  ` : ''}Page ${i + 1} of ${pages.length}`;
        const footOp = `BT /F1 8 Tf 0.45 g ${MARGIN} 30 Td (${encode(foot)}) Tj ET`;
        const stream = [...pageOps, footOp].join('\n');
        const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
        kids.push(
          add(
            `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`,
          ),
        );
      });
      objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
      objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

      let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
      const offsets = [];
      objects.forEach((body, i) => {
        offsets.push(Buffer.byteLength(out, 'latin1'));
        out += `${i + 1} 0 obj\n${body}\nendobj\n`;
      });
      const xref = Buffer.byteLength(out, 'latin1');
      out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
      for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
      out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
      return Buffer.from(out, 'latin1');
    },
  };
  return api;
}

/** RFC 4180 CSV. Cells starting with =, +, - or @ are prefixed with ' so spreadsheets do not run them as formulas. */
export function toCsv(rows) {
  const cell = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}
