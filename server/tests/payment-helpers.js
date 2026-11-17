import { randomUUID } from 'node:crypto';
import { prisma } from '../src/db/prisma.js';
import { createStaffClient } from './auth-helpers.js';
import { onboardedInvestor, PDF } from './kyc-helpers.js';

export const idem = () => `k-${randomUUID()}`;

/** An onboarded investor whose KYC is approved (set directly; the review workflow has its own tests). */
export async function verifiedInvestor(app, opts = {}) {
  const investor = await onboardedInvestor(app, opts);
  await prisma.investorProfile.update({
    where: { userId: investor.userId },
    data: { kycStatus: 'APPROVED', kycVerifiedAt: new Date(), riskRating: 'LOW' },
  });
  return investor;
}

/** Runs the full sandbox deposit flow (initiate → hosted checkout → signed webhook) and returns the deposit. */
export async function deposit(investor, amount, outcome = 'success') {
  const init = await investor.client.post('/api/v1/wallet/deposits').set('Idempotency-Key', idem()).send({ amount }).expect(201);
  const done = await investor.client.post(`/api/v1/payments/sandbox/${init.body.data.reference}/complete`).send({ outcome }).expect(200);
  return done.body.data;
}

export const available = async (client) =>
  (await client.get('/api/v1/wallet').expect(200)).body.data.wallets.find((w) => w.currency === 'GHS').available.amountMinor;

const LONG = 'Sandbox test product used by the automated test suite to exercise ordering, allocation and maturity. '.repeat(2);
let staff;
/** Creates and publishes a product through the admin API (maker and checker are different people). */
export async function publishedProduct(app, overrides = {}) {
  staff ??= { maker: await createStaffClient(['INVESTMENT_MANAGER'], app), checker: await createStaffClient(['INVESTMENT_MANAGER'], app) };
  const created = await staff.maker.client
    .post('/api/v1/admin/products')
    .send({
      slug: `test-${randomUUID().slice(0, 8)}`,
      name: 'Test Treasury Bill',
      shortDescription: 'Automated test product, not a real offer.',
      description: LONG,
      categorySlug: 'government-securities',
      productType: 'TREASURY_BILL',
      issuerName: 'Test issuer',
      currency: 'GHS',
      minInvestment: '100.00',
      returnType: 'FIXED',
      annualRatePercent: '20',
      termDays: 91,
      redemptionTerms: 'Repaid at maturity. No early exit.',
      entryFeePercent: '1',
      managementFeePercent: '2',
      riskLevel: 2,
      minRiskProfile: 'CONSERVATIVE',
      riskDisclosure: LONG,
      eligibleInvestorTypes: ['INDIVIDUAL', 'INSTITUTIONAL'],
      ...overrides,
    })
    .expect(201);
  await staff.maker.client
    .post(`/api/v1/admin/products/${created.body.data.id}/documents`)
    .field('kind', 'KEY_INFORMATION')
    .field('title', 'Key information')
    .attach('file', PDF, 'kid.pdf')
    .expect(201);
  const pub = await staff.checker.client.post(`/api/v1/admin/products/${created.body.data.id}/publish`).expect(200);
  return pub.body.data;
}
