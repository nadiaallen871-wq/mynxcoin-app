import { createHash } from 'node:crypto';

/**
 * Upload validation. The declared Content-Type and file extension are never
 * trusted: the type is detected from the file's magic bytes.
 */
export const ALLOWED_TYPES = Object.freeze({
  'image/jpeg': { ext: 'jpg', magic: [[0xff, 0xd8, 0xff]] },
  'image/png': { ext: 'png', magic: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]] },
  'application/pdf': { ext: 'pdf', magic: [[0x25, 0x50, 0x44, 0x46, 0x2d]] }, // %PDF-
});

export function detectMimeType(buffer) {
  for (const [mime, { magic }] of Object.entries(ALLOWED_TYPES)) {
    if (magic.some((sig) => sig.every((byte, i) => buffer[i] === byte))) return mime;
  }
  return null;
}

/**
 * Heuristic content screen for PDFs: rejects active content (JavaScript, launch
 * actions, embedded files) that identity documents never need. This complements,
 * and does not replace, an antivirus scanner (e.g. ClamAV), which plugs in through
 * `scanner.scan()` once deployed.
 */
const PDF_ACTIVE_CONTENT = /\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA|RichMedia|XFA)\b/;

export function createBasicScanner() {
  return {
    name: 'basic-heuristic',
    async scan(buffer, mimeType) {
      if (mimeType === 'application/pdf' && PDF_ACTIVE_CONTENT.test(buffer.toString('latin1'))) {
        return { clean: false, reason: 'PDF contains active content (scripts, actions or embedded files)' };
      }
      return { clean: true };
    },
  };
}

/** Keeps a readable, harmless filename for display only. Storage keys never use it. */
export function sanitizeFilename(name) {
  const base = String(name ?? 'document')
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(-120);
  return base || 'document';
}

export const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
