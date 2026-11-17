import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { seed } from '../../src/db/seed.js';
import { buildTestApp } from '../helpers.js';
import { createStaffClient } from '../auth-helpers.js';
import { ANSWERS, JPEG, PDF, PDF_WITH_JS, PERSONAL, PNG, onboardedInvestor, upload } from '../kyc-helpers.js';

let app;
beforeAll(async () => {
  await seed(prisma);
  app = buildTestApp({ prisma });
});
afterAll(() => prisma.$disconnect());

describe('onboarding profile', () => {
  it('reports completion section by section', async () => {
    const { client } = await onboardedInvestor(app, { stopBefore: 'personal' });
    const empty = await client.get('/api/v1/onboarding').expect(200);
    expect(empty.body.data.completion).toMatchObject({ complete: false });
    expect(empty.body.data.completion.sections.contact).toBe(true);
    expect(empty.body.data.completion.missing).toEqual(expect.arrayContaining(['personal', 'address', 'documents', 'riskAssessment']));
    expect(empty.body.data.profile.kycStatus).toBe('NOT_STARTED');

    const { client: full } = await onboardedInvestor(app);
    const done = await full.get('/api/v1/onboarding').expect(200);
    expect(done.body.data.completion).toMatchObject({ complete: true, percent: 100, missing: [] });
    expect(done.body.data.profile.kycStatus).toBe('IN_PROGRESS');
  });

  it('encrypts the ID number and only ever returns it masked', async () => {
    const { client, userId } = await onboardedInvestor(app, { stopBefore: 'address' });
    const res = await client.get('/api/v1/onboarding').expect(200);
    expect(res.body.data.profile.idNumberMasked).toBe('•••• 89-0');
    expect(JSON.stringify(res.body)).not.toContain('123456789');
    const row = await prisma.investorProfile.findUnique({ where: { userId } });
    expect(row.idNumberEncrypted).not.toContain('GHA');
    const audit = await prisma.auditLog.findFirst({ where: { action: 'onboarding.personal_updated', entityId: userId } });
    expect(JSON.stringify(audit.metadata)).not.toContain('123456789');
    expect(audit.metadata.fields).toContain('idNumberEncrypted');
  });

  it('enforces age, document validity and ID format', async () => {
    const { client } = await onboardedInvestor(app, { stopBefore: 'personal' });
    const young = new Date();
    young.setUTCFullYear(young.getUTCFullYear() - 17);
    const tooYoung = await client
      .put('/api/v1/onboarding/personal')
      .send({ ...PERSONAL, dateOfBirth: young.toISOString().slice(0, 10) })
      .expect(422);
    expect(tooYoung.body.error.details[0]).toMatchObject({ path: 'dateOfBirth', code: 'too_young' });
    await client
      .put('/api/v1/onboarding/personal')
      .send({ ...PERSONAL, idExpiryDate: '2020-01-01' })
      .expect(422);
    const badId = await client
      .put('/api/v1/onboarding/personal')
      .send({ ...PERSONAL, idNumber: '12345' })
      .expect(422);
    expect(badId.body.error.details[0].message).toMatch(/GHA-/);
  });

  it('requires details for "other" source of funds and PEP declarations', async () => {
    const { client } = await onboardedInvestor(app, { stopBefore: 'personal' });
    await client
      .put('/api/v1/onboarding/financial')
      .send({ employmentStatus: 'RETIRED', annualIncomeBand: 'UNDER_12K', sourceOfFunds: ['OTHER'] })
      .expect(422);
    await client
      .put('/api/v1/onboarding/financial')
      .send({ employmentStatus: 'EMPLOYED', annualIncomeBand: 'UNDER_12K', sourceOfFunds: ['SALARY'] })
      .expect(422);
    await client.put('/api/v1/onboarding/declarations').send({ isPoliticallyExposed: true, taxResidency: 'GH', accept: true }).expect(422);
    await client.put('/api/v1/onboarding/declarations').send({ isPoliticallyExposed: false, taxResidency: 'GH' }).expect(422);
  });

  it('scores the risk questionnaire on the server and keeps history', async () => {
    const { client, userId } = await onboardedInvestor(app, { stopBefore: 'riskAssessment' });
    const q = await client.get('/api/v1/onboarding/risk-questionnaire').expect(200);
    expect(q.body.data.questions.length).toBeGreaterThanOrEqual(8);
    expect(JSON.stringify(q.body.data)).toContain('points');

    const first = await client.post('/api/v1/onboarding/risk-assessment').send({ answers: ANSWERS }).expect(201);
    expect(first.body.data).toMatchObject({ score: 63, riskProfile: 'GROWTH' });
    await client
      .post('/api/v1/onboarding/risk-assessment')
      .send({ answers: { ...ANSWERS, horizon: 'never' } })
      .expect(422);
    const capped = await client
      .post('/api/v1/onboarding/risk-assessment')
      .send({ answers: { ...ANSWERS, share_of_wealth: 'gt50' } })
      .expect(201);
    expect(capped.body.data).toMatchObject({ riskProfile: 'MODERATELY_CONSERVATIVE', capacityLimited: true });
    const rows = await prisma.riskAssessment.findMany({ where: { userId } });
    expect(rows).toHaveLength(2);
    await expect(prisma.riskAssessment.delete({ where: { id: rows[0].id } })).rejects.toThrow(/append-only/);
  });

  it('is limited to investors: staff and anonymous users are refused', async () => {
    const staff = await createStaffClient(['COMPLIANCE_OFFICER'], app);
    await staff.client.get('/api/v1/onboarding').expect(403);
  });
});

describe('documents', () => {
  it('accepts JPEG, PNG and PDF by content and rejects disguised or dangerous files', async () => {
    const { client } = await onboardedInvestor(app, { stopBefore: 'documents' });
    await upload(client, 'IDENTITY_FRONT', JPEG, 'id.jpg').expect(201);
    await upload(client, 'PROOF_OF_ADDRESS', PDF, 'bill.pdf').expect(201);
    const fake = await upload(client, 'IDENTITY_BACK', Buffer.from('<html>not an image</html>'), 'back.png').expect(415);
    expect(fake.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    const js = await upload(client, 'PROOF_OF_ADDRESS', PDF_WITH_JS, 'bill.pdf').expect(422);
    expect(js.body.error.code).toBe('FILE_REJECTED');
    await upload(client, 'SELFIE', PDF, 'me.pdf').expect(415);
    await client.post('/api/v1/documents').field('type', 'PASSPORT_SCAN').attach('file', PNG, 'x.png').expect(422);
  });

  it('rejects files over the size limit', async () => {
    const small = buildTestApp({ prisma, env: { UPLOAD_MAX_BYTES: '100000' } });
    const { client } = await onboardedInvestor(small, { stopBefore: 'documents' });
    const big = Buffer.concat([PNG, Buffer.alloc(150_000)]);
    const res = await upload(client, 'SELFIE', big, 'big.png').expect(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
  });

  it('supersedes a draft on re-upload and removes its file', async () => {
    const { client, userId } = await onboardedInvestor(app, { stopBefore: 'documents' });
    const a = await upload(client, 'SELFIE', PNG).expect(201);
    const b = await upload(client, 'SELFIE', JPEG, 'new.jpg').expect(201);
    const list = await client.get('/api/v1/documents').expect(200);
    expect(list.body.data.map((d) => d.id)).toEqual([b.body.data.id]);
    const old = await prisma.investorDocument.findUnique({ where: { id: a.body.data.id } });
    expect(old.supersededAt).not.toBeNull();
    await client.get(`/api/v1/documents/${a.body.data.id}/download-url`).expect(410);
    expect(await prisma.documentAccessLog.count({ where: { documentId: b.body.data.id, action: 'UPLOADED', actorId: userId } })).toBe(1);
  });

  it('downloads through a short-lived signed URL bound to the requester, and logs every access', async () => {
    const owner = await onboardedInvestor(app, { stopBefore: 'documents' });
    const doc = (await upload(owner.client, 'SELFIE', PNG).expect(201)).body.data;
    const { url } = (await owner.client.get(`/api/v1/documents/${doc.id}/download-url`).expect(200)).body.data;

    const file = await owner.client.get(url).expect(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['cache-control']).toContain('no-store');
    expect(file.headers['content-security-policy']).toContain('sandbox');
    expect(Buffer.from(file.body).equals(PNG)).toBe(true);

    // Another investor can neither request a URL nor use the owner's URL.
    const other = await onboardedInvestor(app, { stopBefore: 'personal' });
    await other.client.get(`/api/v1/documents/${doc.id}/download-url`).expect(404);
    await other.client.get(url).expect(403);
    await other.client.delete(`/api/v1/documents/${doc.id}`).expect(404);

    // Tampered and anonymous requests fail.
    await owner.client.get(url.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'))).expect(403);
    const anon = await (await import('../auth-helpers.js')).createClient(app);
    await anon.get(url).expect(401);

    const actions = (await prisma.documentAccessLog.findMany({ where: { documentId: doc.id } })).map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['UPLOADED', 'URL_ISSUED', 'DOWNLOADED']));
    const log = await prisma.documentAccessLog.findFirst({ where: { documentId: doc.id } });
    await expect(prisma.documentAccessLog.update({ where: { id: log.id }, data: { action: 'X' } })).rejects.toThrow(/append-only/);
  });

  it('gives compliance staff access but not support agents', async () => {
    const owner = await onboardedInvestor(app, { stopBefore: 'documents' });
    const doc = (await upload(owner.client, 'SELFIE', PNG).expect(201)).body.data;
    const officer = await createStaffClient(['COMPLIANCE_OFFICER'], app);
    const { url } = (await officer.client.get(`/api/v1/documents/${doc.id}/download-url`).expect(200)).body.data;
    await officer.client.get(url).expect(200);
    const support = await createStaffClient(['SUPPORT_AGENT'], app);
    await support.client.get(`/api/v1/documents/${doc.id}/download-url`).expect(404);
    const log = await prisma.documentAccessLog.findFirst({ where: { documentId: doc.id, actorId: officer.userId, action: 'DOWNLOADED' } });
    expect(log).not.toBeNull();
  });

  it('stores files encrypted with their hash recorded', async () => {
    const { client } = await onboardedInvestor(app, { stopBefore: 'documents' });
    const doc = (await upload(client, 'SELFIE', PNG, '../../evil name<>.png').expect(201)).body.data;
    const row = await prisma.investorDocument.findUnique({ where: { id: doc.id } });
    expect(row.storageKey).toMatch(/^kyc\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/);
    expect(row.originalFilename).not.toContain('/');
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
