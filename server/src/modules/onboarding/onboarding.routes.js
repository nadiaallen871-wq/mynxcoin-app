import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requestContext, requirePermission } from '../../middleware/auth.js';
import {
  EMPLOYMENT_STATUSES,
  EXPERIENCE_LEVELS,
  ID_TYPES,
  INCOME_BANDS,
  INVESTMENT_OBJECTIVES,
  SOURCE_OF_FUNDS,
} from './onboarding.constants.js';

const country = z.string().regex(/^[A-Z]{2}$/, 'Use a 2-letter country code');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const text = (max, min = 1) => z.string().trim().min(min).max(max);
const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null);

const schemas = {
  personal: z.object({
    dateOfBirth: isoDate,
    nationality: country,
    idType: z.enum(ID_TYPES),
    idNumber: text(30, 5),
    idExpiryDate: isoDate,
    idIssuingCountry: country,
  }),
  address: z.object({
    addressLine1: text(200, 3),
    addressLine2: optionalText(200),
    city: text(100),
    region: text(100),
    postalCode: optionalText(20),
    addressCountry: country,
  }),
  financial: z.object({
    employmentStatus: z.enum(EMPLOYMENT_STATUSES),
    occupation: optionalText(120),
    employerName: optionalText(200),
    annualIncomeBand: z.enum(INCOME_BANDS),
    sourceOfFunds: z.array(z.enum(SOURCE_OF_FUNDS)).min(1, 'Choose at least one source of funds').max(SOURCE_OF_FUNDS.length),
    sourceOfFundsDetails: optionalText(1000),
  }),
  investment: z.object({
    investmentObjectives: z.array(z.enum(INVESTMENT_OBJECTIVES)).min(1, 'Choose at least one objective').max(INVESTMENT_OBJECTIVES.length),
    investmentExperience: z.enum(EXPERIENCE_LEVELS),
  }),
  institution: z.object({ registrationNumber: text(64, 3), incorporationDate: isoDate, incorporationCountry: country }),
  declarations: z.object({
    isPoliticallyExposed: z.boolean(),
    pepDetails: optionalText(1000),
    taxResidency: country,
    accept: z.literal(true, { error: 'Confirm that the information is accurate' }),
  }),
};

/** /api/v1/onboarding: the investor's own KYC profile and suitability questionnaire. */
export function onboardingRoutes({ onboardingService }) {
  const r = Router();
  const own = requirePermission('kyc:submit:own');
  const s = onboardingService;

  r.get('/', own, async (req, res) => res.set('Cache-Control', 'no-store').json({ data: await s.overview(req.auth) }));
  r.get('/risk-questionnaire', own, (_req, res) => res.json({ data: s.questionnaire() }));

  const section = (path, schema, fn) =>
    r.put(path, own, validate({ body: schema }), async (req, res) => res.json({ data: await fn(req.auth, req.body, requestContext(req)) }));
  section('/personal', schemas.personal, s.updatePersonal);
  section('/address', schemas.address, s.updateAddress);
  section('/financial', schemas.financial, s.updateFinancial);
  section('/investment', schemas.investment, s.updateInvestment);
  section('/institution', schemas.institution, s.updateInstitution);
  section('/declarations', schemas.declarations, s.updateDeclarations);

  r.post('/risk-assessment', own, validate({ body: z.object({ answers: z.record(z.string(), z.string()) }) }), async (req, res) => {
    res.status(201).json({ data: await s.submitRiskAssessment(req.auth, req.body, requestContext(req)) });
  });

  return r;
}
