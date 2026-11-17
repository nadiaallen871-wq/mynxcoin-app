import { prisma } from '../src/db/prisma.js';
import { createClient, login, registerVerified, uniqueEmail } from './auth-helpers.js';

// Minimal files whose magic bytes identify their type (content is irrelevant to validation).
export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 7)]);
export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 3)]);
export const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF');
export const PDF_WITH_JS = Buffer.from(
  '%PDF-1.4\n1 0 obj << /Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >> endobj\n%%EOF',
);

export const ANSWERS = {
  horizon: '5to10',
  drawdown: 'hold',
  objective: 'balanced',
  emergency_fund: '3to6',
  share_of_wealth: '10to25',
  knowledge: 'basic',
  income_stability: 'stable',
  loss_tolerance: 'up15',
};

const yearsAgo = (n) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - n);
  return d.toISOString().slice(0, 10);
};
const yearsAhead = (n) => yearsAgo(-n);

export const PERSONAL = {
  dateOfBirth: yearsAgo(30),
  nationality: 'GH',
  idType: 'GHANA_CARD',
  idNumber: 'GHA-123456789-0',
  idExpiryDate: yearsAhead(5),
  idIssuingCountry: 'GH',
};
export const ADDRESS = { addressLine1: '12 Independence Avenue', city: 'Accra', region: 'Greater Accra', addressCountry: 'GH' };
export const FINANCIAL = {
  employmentStatus: 'EMPLOYED',
  occupation: 'Engineer',
  employerName: 'Acme Ltd',
  annualIncomeBand: 'FROM_60K_TO_240K',
  sourceOfFunds: ['SALARY', 'SAVINGS'],
};
export const INVESTMENT = { investmentObjectives: ['LONG_TERM_GROWTH'], investmentExperience: 'LIMITED' };
export const DECLARATIONS = { isPoliticallyExposed: false, taxResidency: 'GH', accept: true };

export function upload(client, type, buffer = PNG, filename = 'scan.png') {
  return client.post('/api/v1/documents').field('type', type).attach('file', buffer, filename);
}

/**
 * Registers, verifies (email + phone) and signs in an investor, then completes
 * every onboarding section and uploads all required documents.
 * `stopBefore` leaves the named step undone.
 */
export async function onboardedInvestor(app, { firstName = 'Ama', lastName = 'Mensah', overrides = {}, stopBefore, register = {} } = {}) {
  const client = await createClient(app);
  const email = uniqueEmail('kyc');
  const { userId } = await registerVerified(client, { email, firstName, lastName, ...register });
  // Phone verification has its own tests. Here the verified state is set directly.
  const phone = `+23320${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
  await prisma.user.update({ where: { id: userId }, data: { phone, phoneVerifiedAt: new Date() } });
  await login(client, email).expect(200);

  const steps = [
    [
      'personal',
      () =>
        client
          .put('/api/v1/onboarding/personal')
          .send({ ...PERSONAL, ...overrides.personal })
          .expect(200),
    ],
    ['address', () => client.put('/api/v1/onboarding/address').send(ADDRESS).expect(200)],
    ['financial', () => client.put('/api/v1/onboarding/financial').send(FINANCIAL).expect(200)],
    ['investment', () => client.put('/api/v1/onboarding/investment').send(INVESTMENT).expect(200)],
    [
      'declarations',
      () =>
        client
          .put('/api/v1/onboarding/declarations')
          .send({ ...DECLARATIONS, ...overrides.declarations })
          .expect(200),
    ],
    ['riskAssessment', () => client.post('/api/v1/onboarding/risk-assessment').send({ answers: ANSWERS }).expect(201)],
    [
      'documents',
      async () => {
        for (const type of ['IDENTITY_FRONT', 'IDENTITY_BACK', 'PROOF_OF_ADDRESS', 'SELFIE']) await upload(client, type).expect(201);
      },
    ],
  ];
  for (const [name, run] of steps) {
    if (name === stopBefore) break;
    await run();
  }
  return { client, email, userId };
}
