import { createCipher } from '../../utils/crypto.js';
import { AppError, ConflictError, ValidationError } from '../../utils/errors.js';
import { ID_NUMBER_PATTERNS, MINIMUM_AGE, RISK_QUESTIONNAIRE, requiredDocumentTypes, scoreQuestionnaire } from './onboarding.constants.js';

/** KYC statuses in which the investor may still edit onboarding data. */
export const EDITABLE_STATUSES = new Set(['NOT_STARTED', 'IN_PROGRESS', 'RESUBMISSION_REQUIRED']);

const fieldError = (path, message, code = 'invalid') => new ValidationError([{ location: 'body', path, message, code }]);

function ageOn(dob, today = new Date()) {
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  const m = today.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age;
}

const toDate = (iso) => (iso ? new Date(`${iso}T00:00:00.000Z`) : iso);
const fromDate = (d) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * Investor onboarding: the KYC profile sections, the suitability questionnaire
 * and the completion status that gates KYC submission. Outcome fields
 * (kycStatus, riskRating, verifiedAt) are written only by the KYC review service.
 */
export function createOnboardingService({ prisma, env, audit }) {
  const cipher = createCipher(env.ENCRYPTION_KEY);

  async function profileFor(userId, tx = prisma) {
    return (await tx.investorProfile.findUnique({ where: { userId } })) ?? tx.investorProfile.create({ data: { userId } });
  }

  function assertEditable(profile) {
    if (!EDITABLE_STATUSES.has(profile.kycStatus)) {
      throw new ConflictError(
        profile.kycStatus === 'APPROVED'
          ? 'Your details are verified. Contact support to change verified information.'
          : profile.kycStatus === 'REJECTED'
            ? 'Your verification was declined. Contact support for help.'
            : 'Your details are under review and cannot be changed until the review is complete.',
        'ONBOARDING_LOCKED',
      );
    }
  }

  /** Profile as shown to its owner or to compliance staff. The ID number is always masked. */
  function serialize(p) {
    return {
      dateOfBirth: fromDate(p.dateOfBirth),
      nationality: p.nationality,
      idType: p.idType,
      idNumberMasked: p.idNumberLast4 ? `•••• ${p.idNumberLast4}` : null,
      idExpiryDate: fromDate(p.idExpiryDate),
      idIssuingCountry: p.idIssuingCountry,
      addressLine1: p.addressLine1,
      addressLine2: p.addressLine2,
      city: p.city,
      region: p.region,
      postalCode: p.postalCode,
      addressCountry: p.addressCountry,
      employmentStatus: p.employmentStatus,
      occupation: p.occupation,
      employerName: p.employerName,
      annualIncomeBand: p.annualIncomeBand,
      sourceOfFunds: p.sourceOfFunds,
      sourceOfFundsDetails: p.sourceOfFundsDetails,
      investmentObjectives: p.investmentObjectives,
      investmentExperience: p.investmentExperience,
      registrationNumber: p.registrationNumber,
      incorporationDate: fromDate(p.incorporationDate),
      incorporationCountry: p.incorporationCountry,
      isPoliticallyExposed: p.isPoliticallyExposed,
      pepDetails: p.pepDetails,
      taxResidency: p.taxResidency,
      declarationsAccepted: Boolean(p.declarationsAcceptedAt),
      kycStatus: p.kycStatus,
      kycVerifiedAt: p.kycVerifiedAt,
    };
  }

  /** Which sections are complete, and what is still missing before KYC can be submitted. */
  function completion({ user, profile: p, risk, documents }) {
    const needsOccupation = ['EMPLOYED', 'SELF_EMPLOYED'].includes(p.employmentStatus);
    const current = documents.filter((d) => !d.supersededAt);
    const required = requiredDocumentTypes({ userType: user.type, idType: p.idType });
    const docStatus = Object.fromEntries(required.map((t) => [t, current.find((d) => d.type === t)?.status ?? 'MISSING']));

    const sections = {
      contact: Boolean(user.emailVerifiedAt && user.phoneVerifiedAt),
      personal: Boolean(p.dateOfBirth && p.nationality && p.idType && p.idNumberEncrypted && p.idExpiryDate && p.idIssuingCountry),
      address: Boolean(p.addressLine1 && p.city && p.region && p.addressCountry),
      financial: Boolean(
        p.employmentStatus &&
        p.annualIncomeBand &&
        p.sourceOfFunds.length &&
        (!needsOccupation || p.occupation) &&
        (!p.sourceOfFunds.includes('OTHER') || p.sourceOfFundsDetails),
      ),
      investment: Boolean(p.investmentObjectives.length && p.investmentExperience),
      ...(user.type === 'INSTITUTIONAL'
        ? { institution: Boolean(p.registrationNumber && p.incorporationDate && p.incorporationCountry) }
        : {}),
      declarations: p.isPoliticallyExposed !== null && Boolean(p.taxResidency && p.declarationsAcceptedAt),
      riskAssessment: Boolean(risk),
      documents: Object.values(docStatus).every((s) => s === 'UPLOADED' || s === 'ACCEPTED'),
    };
    const missing = Object.entries(sections)
      .filter(([, done]) => !done)
      .map(([key]) => key);
    const done = Object.values(sections).filter(Boolean).length;
    return {
      sections,
      requiredDocuments: docStatus,
      missing,
      percent: Math.round((done / Object.keys(sections).length) * 100),
      complete: missing.length === 0,
    };
  }

  async function load(userId, tx = prisma) {
    const [user, profile, risk, documents] = await Promise.all([
      tx.user.findUniqueOrThrow({ where: { id: userId } }),
      profileFor(userId, tx),
      tx.riskAssessment.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
      tx.investorDocument.findMany({ where: { userId, supersededAt: null }, orderBy: { createdAt: 'desc' } }),
    ]);
    return { user, profile, risk, documents };
  }

  async function saveSection(auth, section, data, ctx) {
    return prisma.$transaction(async (tx) => {
      const profile = await profileFor(auth.user.id, tx);
      assertEditable(profile);
      const updated = await tx.investorProfile.update({
        where: { userId: auth.user.id },
        data: { ...data, ...(profile.kycStatus === 'NOT_STARTED' ? { kycStatus: 'IN_PROGRESS' } : {}) },
      });
      // The audit trail records which fields changed, never their values (personal data minimisation).
      await audit.record(
        {
          actorId: auth.user.id,
          action: `onboarding.${section}_updated`,
          entityType: 'investor_profile',
          entityId: auth.user.id,
          metadata: { fields: Object.keys(data) },
          ...ctx,
        },
        tx,
      );
      return serialize(updated);
    });
  }

  return {
    load,
    completion,
    serialize,
    assertEditable,
    profileFor,

    async overview(auth) {
      const state = await load(auth.user.id);
      const application = await prisma.kycApplication.findFirst({ where: { userId: auth.user.id }, orderBy: { createdAt: 'desc' } });
      return {
        accountType: state.user.type,
        profile: serialize(state.profile),
        editable: EDITABLE_STATUSES.has(state.profile.kycStatus),
        riskAssessment: state.risk && {
          score: state.risk.score,
          riskProfile: state.risk.riskProfile,
          answers: state.risk.answers,
          completedAt: state.risk.createdAt,
        },
        completion: completion(state),
        documents: state.documents.map((d) => ({
          id: d.id,
          type: d.type,
          status: d.status,
          filename: d.originalFilename,
          rejectionReason: d.rejectionReason,
          submitted: Boolean(d.applicationId),
          uploadedAt: d.createdAt,
        })),
        application: application && {
          id: application.id,
          status: application.status,
          submittedAt: application.submittedAt,
          submissionCount: application.submissionCount,
          resubmissionNotes: application.status === 'RESUBMISSION_REQUIRED' ? application.resubmissionNotes : null,
          decidedAt: application.decidedAt,
        },
      };
    },

    async updatePersonal(auth, input, ctx) {
      const dob = toDate(input.dateOfBirth);
      const age = ageOn(dob);
      if (auth.user.type !== 'INSTITUTIONAL' && age < MINIMUM_AGE)
        throw fieldError('dateOfBirth', `You must be at least ${MINIMUM_AGE} years old to open an account`, 'too_young');
      if (age > 120) throw fieldError('dateOfBirth', 'Enter a valid date of birth');
      const expiry = toDate(input.idExpiryDate);
      if (expiry <= new Date()) throw fieldError('idExpiryDate', 'This identity document has expired. Use a valid document', 'expired');
      const idNumber = input.idNumber.trim().toUpperCase();
      if (!ID_NUMBER_PATTERNS[input.idType].test(idNumber)) {
        throw fieldError(
          'idNumber',
          input.idType === 'GHANA_CARD' ? 'Use the format GHA-123456789-0' : 'This number does not match the document type',
          'id_format',
        );
      }
      return saveSection(
        auth,
        'personal',
        {
          dateOfBirth: dob,
          nationality: input.nationality,
          idType: input.idType,
          idNumberEncrypted: cipher.encrypt(idNumber),
          idNumberLast4: idNumber.slice(-4),
          idExpiryDate: expiry,
          idIssuingCountry: input.idIssuingCountry,
        },
        ctx,
      );
    },

    updateAddress: (auth, input, ctx) => saveSection(auth, 'address', input, ctx),

    async updateFinancial(auth, input, ctx) {
      if (['EMPLOYED', 'SELF_EMPLOYED'].includes(input.employmentStatus) && !input.occupation)
        throw fieldError('occupation', 'Tell us your occupation');
      if (input.sourceOfFunds.includes('OTHER') && !input.sourceOfFundsDetails)
        throw fieldError('sourceOfFundsDetails', 'Describe the other source of funds');
      return saveSection(auth, 'financial', { occupation: null, employerName: null, sourceOfFundsDetails: null, ...input }, ctx);
    },

    updateInvestment: (auth, input, ctx) => saveSection(auth, 'investment', input, ctx),

    async updateInstitution(auth, input, ctx) {
      if (auth.user.type !== 'INSTITUTIONAL')
        throw new AppError('Only institutional accounts have organisation details', { status: 400, code: 'NOT_INSTITUTIONAL' });
      const date = toDate(input.incorporationDate);
      if (date > new Date()) throw fieldError('incorporationDate', 'Incorporation date cannot be in the future');
      return saveSection(auth, 'institution', { ...input, incorporationDate: date }, ctx);
    },

    async updateDeclarations(auth, input, ctx) {
      if (input.isPoliticallyExposed && !input.pepDetails)
        throw fieldError('pepDetails', 'Describe the public position held by you or a close associate');
      return saveSection(
        auth,
        'declarations',
        {
          isPoliticallyExposed: input.isPoliticallyExposed,
          pepDetails: input.isPoliticallyExposed ? input.pepDetails : null,
          taxResidency: input.taxResidency,
          declarationsAcceptedAt: new Date(),
        },
        ctx,
      );
    },

    questionnaire: () => RISK_QUESTIONNAIRE,

    async submitRiskAssessment(auth, { answers }, ctx) {
      let result;
      try {
        result = scoreQuestionnaire(answers);
      } catch (err) {
        throw fieldError('answers', err.message, 'questionnaire');
      }
      return prisma.$transaction(async (tx) => {
        const profile = await profileFor(auth.user.id, tx);
        assertEditable(profile);
        const row = await tx.riskAssessment.create({
          data: {
            userId: auth.user.id,
            questionnaireVersion: RISK_QUESTIONNAIRE.version,
            answers,
            score: result.score,
            riskProfile: result.riskProfile,
          },
        });
        if (profile.kycStatus === 'NOT_STARTED')
          await tx.investorProfile.update({ where: { userId: auth.user.id }, data: { kycStatus: 'IN_PROGRESS' } });
        await audit.record(
          {
            actorId: auth.user.id,
            action: 'onboarding.risk_assessment_completed',
            entityType: 'risk_assessment',
            entityId: row.id,
            metadata: { score: result.score, riskProfile: result.riskProfile },
            ...ctx,
          },
          tx,
        );
        return { score: row.score, riskProfile: row.riskProfile, capacityLimited: result.capped, completedAt: row.createdAt };
      });
    },
  };
}
