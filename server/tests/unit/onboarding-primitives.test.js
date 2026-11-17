import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RISK_QUESTIONNAIRE, requiredDocumentTypes, scoreQuestionnaire } from '../../src/modules/onboarding/onboarding.constants.js';
import { createBasicScanner, detectMimeType, sanitizeFilename } from '../../src/modules/documents/file-validation.js';
import { createUrlSigner } from '../../src/modules/documents/signed-url.js';
import { createLocalStorage } from '../../src/integrations/storage/local.storage.js';
import { createSandboxScreening } from '../../src/integrations/screening/sandbox.screening.js';
import { JPEG, PDF, PDF_WITH_JS, PNG } from '../kyc-helpers.js';

const pick = (index) =>
  Object.fromEntries(RISK_QUESTIONNAIRE.questions.map((q) => [q.id, q.options[Math.min(index, q.options.length - 1)].id]));
const lowest = () => Object.fromEntries(RISK_QUESTIONNAIRE.questions.map((q) => [q.id, q.options[0].id]));
const highest = () => Object.fromEntries(RISK_QUESTIONNAIRE.questions.map((q) => [q.id, q.options.at(-1).id]));

describe('risk questionnaire scoring', () => {
  it('maps the extremes to conservative and aggressive', () => {
    expect(scoreQuestionnaire(lowest())).toMatchObject({ score: 0, riskProfile: 'CONSERVATIVE' });
    expect(scoreQuestionnaire(highest())).toMatchObject({ score: 100, riskProfile: 'AGGRESSIVE' });
  });

  it('caps the profile when capacity for loss is low, whatever the appetite', () => {
    const answers = { ...highest(), emergency_fund: 'none' };
    const result = scoreQuestionnaire(answers);
    expect(result.score).toBeGreaterThan(80);
    expect(result.riskProfile).toBe('MODERATELY_CONSERVATIVE');
  });

  it('rejects missing or unknown answers', () => {
    const { horizon: _drop, ...partial } = pick(1);
    expect(() => scoreQuestionnaire(partial)).toThrow(/horizon/);
    expect(() => scoreQuestionnaire({ ...pick(1), horizon: 'forever' })).toThrow(/horizon/);
  });
});

describe('required documents', () => {
  it('depends on the ID type and account type', () => {
    expect(requiredDocumentTypes({ userType: 'INDIVIDUAL', idType: 'PASSPORT' })).toEqual(['IDENTITY_FRONT', 'PROOF_OF_ADDRESS', 'SELFIE']);
    expect(requiredDocumentTypes({ userType: 'INDIVIDUAL', idType: 'GHANA_CARD' })).toContain('IDENTITY_BACK');
    expect(requiredDocumentTypes({ userType: 'INSTITUTIONAL', idType: 'PASSPORT' })).toContain('CERTIFICATE_OF_INCORPORATION');
  });
});

describe('file validation', () => {
  it('detects types from magic bytes, not names', () => {
    expect(detectMimeType(PNG)).toBe('image/png');
    expect(detectMimeType(JPEG)).toBe('image/jpeg');
    expect(detectMimeType(PDF)).toBe('application/pdf');
    expect(detectMimeType(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
    expect(detectMimeType(Buffer.from('MZ\x90\x00'))).toBeNull();
  });

  it('rejects PDFs with active content', async () => {
    const scanner = createBasicScanner();
    expect(await scanner.scan(PDF, 'application/pdf')).toEqual({ clean: true });
    expect((await scanner.scan(PDF_WITH_JS, 'application/pdf')).clean).toBe(false);
  });

  it('sanitises display filenames', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('....etcpasswd');
    expect(sanitizeFilename('<script>.png')).toBe('script.png');
    expect(sanitizeFilename('')).toBe('document');
  });
});

describe('signed download URLs', () => {
  const signer = createUrlSigner({ secret: 's'.repeat(40), ttlSeconds: 60 });

  it('verifies a fresh token and binds it to the actor', () => {
    const { token } = signer.issue({ documentId: 'doc-1', actorId: 'user-1' });
    expect(signer.verify(token)).toEqual({ documentId: 'doc-1', actorId: 'user-1' });
  });

  it('rejects expired, tampered and foreign-key tokens', () => {
    const { token } = signer.issue({ documentId: 'doc-1', actorId: 'user-1', now: Date.now() - 120_000 });
    expect(signer.verify(token)).toBeNull();

    const fresh = signer.issue({ documentId: 'doc-1', actorId: 'user-1' }).token;
    const [body, sig] = fresh.split('.');
    const forged = Buffer.from(JSON.stringify({ d: 'doc-2', a: 'user-1', e: 9999999999 })).toString('base64url');
    expect(signer.verify(`${forged}.${sig}`)).toBeNull();
    expect(signer.verify(`${body}.${'0'.repeat(64)}`)).toBeNull();
    expect(createUrlSigner({ secret: 'x'.repeat(40), ttlSeconds: 60 }).verify(fresh)).toBeNull();
    expect(signer.verify('garbage')).toBeNull();
  });
});

describe('encrypted local storage', () => {
  it('round-trips files, stores them encrypted, and rejects path traversal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mynx-storage-'));
    const storage = createLocalStorage({ baseDir: dir, encryptionKey: Buffer.alloc(32, 9).toString('base64') });
    const content = Buffer.from('GHA-123456789-0 identity scan');
    await storage.put('kyc/user-1/file-abc.png', content);
    expect((await storage.get('kyc/user-1/file-abc.png')).equals(content)).toBe(true);

    const raw = await readFile(join(dir, 'kyc', 'user-1', 'file-abc.png'), 'utf8');
    expect(raw).not.toContain('GHA-123456789');
    expect(raw).not.toContain(content.toString('base64'));

    await expect(storage.put('../escape.png', content)).rejects.toThrow();
    await expect(storage.put('kyc/../../escape.png', content)).rejects.toThrow();
    await expect(storage.put('kyc/user-1/file-abc.png', content)).rejects.toThrow(); // never overwrites
    await storage.delete('kyc/user-1/file-abc.png');
    expect(await readdir(join(dir, 'kyc', 'user-1'))).toEqual([]);
  });
});

describe('sandbox screening', () => {
  it('matches only documented test names', async () => {
    const screening = createSandboxScreening();
    expect(await screening.screen({ fullName: 'Ama Mensah' })).toEqual({ status: 'CLEAR', matches: [] });
    const hit = await screening.screen({ fullName: 'Kofi Sandbox Sanctioned' });
    expect(hit.status).toBe('POTENTIAL_MATCH');
    expect(hit.matches[0].list).toBe('SANDBOX-SANCTIONS');
  });
});
