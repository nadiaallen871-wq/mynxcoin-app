import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { seed } from '../../src/db/seed.js';
import { buildTestApp } from '../helpers.js';
import { createStaffClient, lastMessage } from '../auth-helpers.js';
import { JPEG, onboardedInvestor, upload } from '../kyc-helpers.js';

let app;
let officer;
beforeAll(async () => {
  await seed(prisma);
  app = buildTestApp({ prisma });
  officer = await createStaffClient(['COMPLIANCE_OFFICER'], app);
});
afterAll(() => prisma.$disconnect());

const base = (id) => `/api/v1/admin/kyc/applications/${id}`;

async function submitted(opts) {
  const investor = await onboardedInvestor(app, opts);
  const res = await investor.client.post('/api/v1/kyc/submit').expect(201);
  return { ...investor, applicationId: res.body.data.id };
}

async function acceptAll(applicationId) {
  const detail = await officer.client.get(base(applicationId)).expect(200);
  return detail.body.data.documents.filter((d) => d.current).map((d) => ({ id: d.id, status: 'ACCEPTED' }));
}

describe('KYC submission', () => {
  it('refuses incomplete onboarding and lists what is missing', async () => {
    const { client } = await onboardedInvestor(app, { stopBefore: 'documents' });
    const res = await client.post('/api/v1/kyc/submit').expect(422);
    expect(res.body.error.details.map((d) => d.path)).toEqual(['documents']);
  });

  it('submits, snapshots the profile, attaches documents, screens, notifies, and locks editing', async () => {
    const { client, email, userId, applicationId } = await submitted();
    const app_ = await prisma.kycApplication.findUnique({ where: { id: applicationId }, include: { documents: true, screening: true } });
    expect(app_.status).toBe('SUBMITTED');
    expect(app_.documents).toHaveLength(4);
    expect(app_.screening[0]).toMatchObject({ provider: 'sandbox', status: 'CLEAR' });
    expect(JSON.stringify(app_.profileSnapshot)).not.toContain('123456789');
    expect(await lastMessage(email, 'kyc-submitted')).not.toBeNull();

    const locked = await client
      .put('/api/v1/onboarding/address')
      .send({ addressLine1: 'New street 1', city: 'Kumasi', region: 'Ashanti', addressCountry: 'GH' })
      .expect(409);
    expect(locked.body.error.code).toBe('ONBOARDING_LOCKED');
    await upload(client, 'SELFIE', JPEG).expect(409);
    const docId = app_.documents[0].id;
    await client.delete(`/api/v1/documents/${docId}`).expect(409);
    await expect(prisma.investorDocument.delete({ where: { id: docId } })).rejects.toThrow(/retained/);
    await client.post('/api/v1/kyc/submit').expect(409);
    expect((await prisma.investorProfile.findUnique({ where: { userId } })).kycStatus).toBe('SUBMITTED');
  });
});

describe('compliance review', () => {
  it('shows the queue to compliance officers and auditors, but not to support agents or investors', async () => {
    const { applicationId, client } = await submitted();
    const queue = await officer.client.get('/api/v1/admin/kyc/applications?status=SUBMITTED&pageSize=100').expect(200);
    expect(queue.body.data.map((a) => a.id)).toContain(applicationId);
    expect(queue.body.meta.counts.SUBMITTED).toBeGreaterThan(0);

    const auditor = await createStaffClient(['AUDITOR'], app);
    await auditor.client.get(base(applicationId)).expect(200);
    await auditor.client.post(`${base(applicationId)}/claim`).expect(403);

    const support = await createStaffClient(['SUPPORT_AGENT'], app);
    await support.client.get('/api/v1/admin/kyc/applications').expect(403);
    await client.get('/api/v1/admin/kyc/applications').expect(403);
  });

  it('requires a claim, and only the claiming reviewer can decide', async () => {
    const { applicationId } = await submitted();
    const early = await officer.client
      .post(`${base(applicationId)}/decision`)
      .send({ decision: 'REJECT', reason: 'Not claimed yet, should fail' })
      .expect(409);
    expect(early.body.error.code).toBe('NOT_UNDER_REVIEW');

    await officer.client.post(`${base(applicationId)}/claim`).expect(200);
    const second = await createStaffClient(['COMPLIANCE_OFFICER'], app);
    await second.client.post(`${base(applicationId)}/claim`).expect(409);
    const notMine = await second.client
      .post(`${base(applicationId)}/decision`)
      .send({ decision: 'REJECT', reason: 'Trying to decide someone else’s case' })
      .expect(409);
    expect(notMine.body.error.code).toBe('NOT_ASSIGNED');

    await officer.client.post(`${base(applicationId)}/release`).expect(200);
    await second.client.post(`${base(applicationId)}/claim`).expect(200);
  });

  it('approves only when all required documents are accepted and a risk rating is set', async () => {
    const { applicationId, userId, email } = await submitted();
    await officer.client.post(`${base(applicationId)}/claim`).expect(200);
    const docs = await acceptAll(applicationId);

    const partial = await officer.client
      .post(`${base(applicationId)}/decision`)
      .send({ decision: 'APPROVE', reason: 'Documents verified against the record', riskRating: 'LOW', documents: docs.slice(0, 2) })
      .expect(409);
    expect(partial.body.error.code).toBe('DOCUMENTS_NOT_ACCEPTED');
    await officer.client
      .post(`${base(applicationId)}/decision`)
      .send({ decision: 'APPROVE', reason: 'Documents verified against the record', documents: docs })
      .expect(422);

    const ok = await officer.client
      .post(`${base(applicationId)}/decision`)
      .send({ decision: 'APPROVE', reason: 'Documents verified against the record', riskRating: 'LOW', documents: docs })
      .expect(200);
    expect(ok.body.data.status).toBe('APPROVED');
    expect(ok.body.data.history.map((h) => h.toStatus)).toEqual(['SUBMITTED', 'UNDER_REVIEW', 'APPROVED']);

    const profile = await prisma.investorProfile.findUnique({ where: { userId } });
    expect(profile).toMatchObject({ kycStatus: 'APPROVED', riskRating: 'LOW' });
    expect(profile.kycVerifiedAt).not.toBeNull();
    expect(await lastMessage(email, 'kyc-approved')).not.toBeNull();
    const event = await prisma.kycReviewEvent.findFirst({ where: { applicationId } });
    await expect(prisma.kycReviewEvent.update({ where: { id: event.id }, data: { note: 'x' } })).rejects.toThrow(/append-only/);
  });

  it('runs the resubmission cycle: rejected document replaced, same application resubmitted', async () => {
    const { applicationId, client, email } = await submitted();
    await officer.client.post(`${base(applicationId)}/claim`).expect(200);
    const docs = await acceptAll(applicationId);
    const selfie = (await officer.client.get(base(applicationId))).body.data.documents.find((d) => d.type === 'SELFIE');
    const decisions = docs.map((d) => (d.id === selfie.id ? { id: d.id, status: 'REJECTED', reason: 'Face not visible' } : d));
    await officer.client
      .post(`${base(applicationId)}/decision`)
      .send({ decision: 'REQUEST_RESUBMISSION', reason: 'Please upload a clear selfie in good light.', documents: decisions })
      .expect(200);
    expect((await lastMessage(email, 'kyc-resubmission')).body).toContain('clear selfie');

    const overview = await client.get('/api/v1/onboarding').expect(200);
    expect(overview.body.data.editable).toBe(true);
    expect(overview.body.data.application.resubmissionNotes).toContain('clear selfie');
    expect(overview.body.data.completion.requiredDocuments.SELFIE).toBe('REJECTED');
    await client.post('/api/v1/kyc/submit').expect(422);

    await upload(client, 'SELFIE', JPEG, 'selfie2.jpg').expect(201);
    const again = await client.post('/api/v1/kyc/submit').expect(201);
    expect(again.body.data).toMatchObject({ id: applicationId, submissionCount: 2, status: 'SUBMITTED' });
    const detail = (await officer.client.get(base(applicationId))).body.data;
    const current = detail.documents.filter((d) => d.current);
    expect(current.find((d) => d.type === 'SELFIE').status).toBe('UPLOADED');
    expect(current.find((d) => d.type === 'IDENTITY_FRONT').status).toBe('ACCEPTED');
    expect(detail.documents.find((d) => d.id === selfie.id)).toMatchObject({ current: false, status: 'REJECTED' });
  });

  it('rejects with a generic email that does not reveal the reason', async () => {
    const { applicationId, email, client } = await submitted();
    await officer.client.post(`${base(applicationId)}/claim`).expect(200);
    await officer.client
      .post(`${base(applicationId)}/decision`)
      .send({ decision: 'REJECT', reason: 'Document appears altered; suspected forgery' })
      .expect(200);
    const msg = await lastMessage(email, 'kyc-rejected');
    expect(msg.body).not.toMatch(/forg|altered/i);
    const res = await client.post('/api/v1/kyc/submit').expect(409);
    expect(res.body.error.code).toBe('KYC_REJECTED');
  });

  it('blocks approval on an unresolved screening match until it is explicitly cleared', async () => {
    const { applicationId } = await submitted({ lastName: 'Sandbox Sanctioned' });
    const detail = (await officer.client.get(base(applicationId))).body.data;
    expect(detail.screening[0].status).toBe('POTENTIAL_MATCH');
    await officer.client.post(`${base(applicationId)}/claim`).expect(200);
    const docs = await acceptAll(applicationId);
    const blocked = await officer.client
      .post(`${base(applicationId)}/decision`)
      .send({ decision: 'APPROVE', reason: 'All documents verified', riskRating: 'MEDIUM', documents: docs })
      .expect(409);
    expect(blocked.body.error.code).toBe('SCREENING_MATCH_UNRESOLVED');
    await officer.client
      .post(`${base(applicationId)}/decision`)
      .send({
        decision: 'APPROVE',
        reason: 'Match reviewed: different date of birth and nationality',
        riskRating: 'MEDIUM',
        documents: docs,
        screeningCleared: true,
      })
      .expect(200);
  });

  it('requires a HIGH risk rating for politically exposed persons', async () => {
    const { applicationId } = await submitted({
      overrides: { declarations: { isPoliticallyExposed: true, pepDetails: 'Sibling is a member of parliament' } },
    });
    await officer.client.post(`${base(applicationId)}/claim`).expect(200);
    const docs = await acceptAll(applicationId);
    const res = await officer.client
      .post(`${base(applicationId)}/decision`)
      .send({ decision: 'APPROVE', reason: 'EDD completed, source of wealth verified', riskRating: 'MEDIUM', documents: docs })
      .expect(409);
    expect(res.body.error.code).toBe('PEP_REQUIRES_HIGH_RISK');
    await officer.client
      .post(`${base(applicationId)}/decision`)
      .send({ decision: 'APPROVE', reason: 'EDD completed, source of wealth verified', riskRating: 'HIGH', documents: docs })
      .expect(200);
  });

  it('records reviewer actions in the audit log', async () => {
    const { applicationId } = await submitted();
    await officer.client.post(`${base(applicationId)}/claim`).expect(200);
    await officer.client
      .post(`${base(applicationId)}/decision`)
      .send({ decision: 'REJECT', reason: 'Identity could not be confirmed' })
      .expect(200);
    const actions = (await prisma.auditLog.findMany({ where: { entityId: applicationId, actorId: officer.userId } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['kyc.claimed', 'kyc.reject']));
  });
});
