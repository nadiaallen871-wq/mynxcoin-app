import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { requiredDocumentTypes } from '../onboarding/onboarding.constants.js';

const OPEN = ['SUBMITTED', 'UNDER_REVIEW', 'RESUBMISSION_REQUIRED'];

/**
 * KYC submission and compliance review.
 *
 * State machine (each transition writes an append-only KycReviewEvent and an audit record):
 *   (none | RESUBMISSION_REQUIRED) --submit--> SUBMITTED --claim--> UNDER_REVIEW
 *   UNDER_REVIEW --decide--> APPROVED | REJECTED | RESUBMISSION_REQUIRED
 *
 * Review rules:
 * - Only the claiming reviewer can decide. Nobody can review their own application.
 * - Approval needs every required document ACCEPTED and a risk rating. A potential
 *   screening match must be explicitly cleared with a recorded justification.
 *   A politically exposed person can only be approved as HIGH risk (enhanced due diligence).
 * - Rejection emails are generic (no tipping off). Detailed reasons stay internal.
 */
export function createKycService({ prisma, audit, messaging, screening, onboarding }) {
  const firstName = (u) => u.profile?.firstName ?? 'there';

  async function event(tx, { applicationId, actorId, fromStatus, toStatus, note }) {
    await tx.kycReviewEvent.create({ data: { applicationId, actorId, fromStatus, toStatus, note: note ?? null } });
  }

  function snapshotOf({ user, profile, risk, documents }) {
    return {
      accountType: user.type,
      name: [user.profile?.firstName, user.profile?.lastName].filter(Boolean).join(' '),
      organizationName: user.profile?.organizationName ?? null,
      email: user.email,
      phone: user.phone,
      profile: onboarding.serialize(profile),
      riskAssessment: risk && { score: risk.score, riskProfile: risk.riskProfile, version: risk.questionnaireVersion },
      documentIds: documents.map((d) => d.id),
    };
  }

  async function loadApplication(id, tx = prisma) {
    const app = await tx.kycApplication.findUnique({ where: { id }, include: { user: { include: { profile: true } } } });
    if (!app) throw new NotFoundError('Application not found');
    return app;
  }

  return {
    async submit(auth, ctx) {
      const state = await onboarding.load(auth.user.id);
      const status = state.profile.kycStatus;
      if (status === 'APPROVED') throw new ConflictError('Your account is already verified', 'ALREADY_VERIFIED');
      if (status === 'REJECTED') throw new ConflictError('Your verification was declined. Contact support for help.', 'KYC_REJECTED');
      if (['SUBMITTED', 'UNDER_REVIEW'].includes(status))
        throw new ConflictError('Your verification is already being reviewed', 'ALREADY_SUBMITTED');
      const comp = onboarding.completion(state);
      if (!comp.complete) {
        throw new ValidationError(
          comp.missing.map((section) => ({
            location: 'body',
            path: section,
            message: `Complete the ${section} section`,
            code: 'incomplete',
          })),
          'Complete every section before submitting',
        );
      }
      const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.user.id }, include: { profile: true } });
      const snapshot = snapshotOf({ ...state, user });
      const result = await screening.screen({
        fullName: snapshot.organizationName ? `${snapshot.organizationName} ${snapshot.name}` : snapshot.name,
        dateOfBirth: snapshot.profile.dateOfBirth,
        nationality: snapshot.profile.nationality,
      });

      const { application, message } = await prisma.$transaction(async (tx) => {
        const open = await tx.kycApplication.findFirst({ where: { userId: auth.user.id, status: { in: OPEN } } });
        let app;
        if (open) {
          if (open.status !== 'RESUBMISSION_REQUIRED')
            throw new ConflictError('Your verification is already being reviewed', 'ALREADY_SUBMITTED');
          app = await tx.kycApplication.update({
            where: { id: open.id },
            data: {
              status: 'SUBMITTED',
              submissionCount: { increment: 1 },
              profileSnapshot: snapshot,
              reviewerId: null,
              submittedAt: new Date(),
            },
          });
          await event(tx, {
            applicationId: app.id,
            actorId: auth.user.id,
            fromStatus: 'RESUBMISSION_REQUIRED',
            toStatus: 'SUBMITTED',
            note: `Resubmission #${app.submissionCount - 1}`,
          });
        } else {
          app = await tx.kycApplication.create({ data: { userId: auth.user.id, profileSnapshot: snapshot } });
          await event(tx, { applicationId: app.id, actorId: auth.user.id, fromStatus: null, toStatus: 'SUBMITTED' });
        }
        await tx.investorDocument.updateMany({
          where: { userId: auth.user.id, supersededAt: null, applicationId: null },
          data: { applicationId: app.id },
        });
        await tx.screeningResult.create({
          data: {
            applicationId: app.id,
            provider: screening.name,
            status: result.status,
            matches: result.matches,
            screenedName: snapshot.name,
          },
        });
        await tx.investorProfile.update({ where: { userId: auth.user.id }, data: { kycStatus: 'SUBMITTED' } });
        await audit.record(
          {
            actorId: auth.user.id,
            action: 'kyc.submitted',
            entityType: 'kyc_application',
            entityId: app.id,
            metadata: { submissionCount: app.submissionCount },
            ...ctx,
          },
          tx,
        );
        const msg = await messaging.queue(tx, {
          userId: user.id,
          recipient: user.email,
          template: 'kyc-submitted',
          vars: { firstName: firstName(user) },
        });
        return { application: app, message: msg };
      });
      await messaging.dispatch([message]);
      return {
        id: application.id,
        status: application.status,
        submittedAt: application.submittedAt,
        submissionCount: application.submissionCount,
      };
    },

    // ── Compliance staff ───────────────────────────────────────────────────

    async list({ status, search, page, pageSize }) {
      const where = {
        ...(status ? { status } : {}),
        ...(search
          ? {
              user: {
                OR: [
                  { email: { contains: search, mode: 'insensitive' } },
                  { profile: { firstName: { contains: search, mode: 'insensitive' } } },
                  { profile: { lastName: { contains: search, mode: 'insensitive' } } },
                  { profile: { organizationName: { contains: search, mode: 'insensitive' } } },
                ],
              },
            }
          : {}),
      };
      const [total, rows, counts] = await prisma.$transaction([
        prisma.kycApplication.count({ where }),
        prisma.kycApplication.findMany({
          where,
          include: {
            user: { select: { email: true, type: true, profile: { select: { firstName: true, lastName: true, organizationName: true } } } },
            reviewer: { select: { profile: { select: { firstName: true, lastName: true } } } },
            screening: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true } },
          },
          // Oldest first: the queue is worked in order of submission.
          orderBy: { submittedAt: 'asc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.kycApplication.groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } }),
      ]);
      return {
        data: rows.map((a) => ({
          id: a.id,
          status: a.status,
          applicant: {
            email: a.user.email,
            type: a.user.type,
            name: [a.user.profile?.firstName, a.user.profile?.lastName].filter(Boolean).join(' '),
            organizationName: a.user.profile?.organizationName ?? null,
          },
          reviewer: a.reviewer?.profile ? `${a.reviewer.profile.firstName} ${a.reviewer.profile.lastName}` : null,
          screeningStatus: a.screening[0]?.status ?? null,
          submissionCount: a.submissionCount,
          submittedAt: a.submittedAt,
        })),
        meta: { page, pageSize, total, counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) },
      };
    },

    async get(id, documentsService) {
      const app = await prisma.kycApplication.findUnique({
        where: { id },
        include: {
          user: { include: { profile: true, investorProfile: true } },
          reviewer: { select: { id: true, profile: { select: { firstName: true, lastName: true } } } },
          documents: { orderBy: { createdAt: 'desc' } },
          screening: { orderBy: { createdAt: 'desc' } },
          events: {
            orderBy: { createdAt: 'asc' },
            include: { actor: { select: { profile: { select: { firstName: true, lastName: true } } } } },
          },
        },
      });
      if (!app) throw new NotFoundError('Application not found');
      const risk = await prisma.riskAssessment.findFirst({ where: { userId: app.userId }, orderBy: { createdAt: 'desc' } });
      const required = requiredDocumentTypes({ userType: app.user.type, idType: app.user.investorProfile?.idType });
      return {
        id: app.id,
        status: app.status,
        submissionCount: app.submissionCount,
        submittedAt: app.submittedAt,
        decidedAt: app.decidedAt,
        decisionReason: app.decisionReason,
        resubmissionNotes: app.resubmissionNotes,
        riskRating: app.riskRating,
        reviewer: app.reviewer && {
          id: app.reviewer.id,
          name: `${app.reviewer.profile?.firstName ?? ''} ${app.reviewer.profile?.lastName ?? ''}`.trim(),
        },
        applicant: {
          id: app.user.id,
          email: app.user.email,
          type: app.user.type,
          phone: app.user.phone,
          firstName: app.user.profile?.firstName,
          lastName: app.user.profile?.lastName,
          organizationName: app.user.profile?.organizationName,
        },
        snapshot: app.profileSnapshot,
        currentProfile: app.user.investorProfile && onboarding.serialize(app.user.investorProfile),
        riskAssessment: risk && {
          score: risk.score,
          riskProfile: risk.riskProfile,
          answers: risk.answers,
          version: risk.questionnaireVersion,
          completedAt: risk.createdAt,
        },
        requiredDocumentTypes: required,
        documents: app.documents.map((d) => ({ ...documentsService.serialize(d), current: !d.supersededAt })),
        screening: app.screening.map((s) => ({
          id: s.id,
          provider: s.provider,
          status: s.status,
          matches: s.matches,
          screenedName: s.screenedName,
          createdAt: s.createdAt,
        })),
        history: app.events.map((e) => ({
          id: e.id.toString(),
          fromStatus: e.fromStatus,
          toStatus: e.toStatus,
          note: e.note,
          actor: e.actor?.profile ? `${e.actor.profile.firstName} ${e.actor.profile.lastName}` : null,
          createdAt: e.createdAt,
        })),
      };
    },

    async claim(auth, id, ctx) {
      await prisma.$transaction(async (tx) => {
        const app = await loadApplication(id, tx);
        if (app.userId === auth.user.id) throw new ForbiddenError('You cannot review your own application');
        if (app.status !== 'SUBMITTED') {
          throw new ConflictError(
            app.status === 'UNDER_REVIEW'
              ? 'Another reviewer is already working on this application'
              : 'This application is not awaiting review',
            'NOT_CLAIMABLE',
          );
        }
        // Conditional update: only one of two reviewers claiming at the same moment succeeds.
        const { count } = await tx.kycApplication.updateMany({
          where: { id, status: 'SUBMITTED' },
          data: { status: 'UNDER_REVIEW', reviewerId: auth.user.id },
        });
        if (count !== 1) throw new ConflictError('Another reviewer is already working on this application', 'NOT_CLAIMABLE');
        await tx.investorProfile.update({ where: { userId: app.userId }, data: { kycStatus: 'UNDER_REVIEW' } });
        await event(tx, { applicationId: id, actorId: auth.user.id, fromStatus: 'SUBMITTED', toStatus: 'UNDER_REVIEW' });
        await audit.record({ actorId: auth.user.id, action: 'kyc.claimed', entityType: 'kyc_application', entityId: id, ...ctx }, tx);
      });
    },

    async release(auth, id, ctx) {
      await prisma.$transaction(async (tx) => {
        const app = await loadApplication(id, tx);
        if (app.status !== 'UNDER_REVIEW' || app.reviewerId !== auth.user.id)
          throw new ConflictError('Only the assigned reviewer can release this application', 'NOT_ASSIGNED');
        await tx.kycApplication.update({ where: { id }, data: { status: 'SUBMITTED', reviewerId: null } });
        await tx.investorProfile.update({ where: { userId: app.userId }, data: { kycStatus: 'SUBMITTED' } });
        await event(tx, {
          applicationId: id,
          actorId: auth.user.id,
          fromStatus: 'UNDER_REVIEW',
          toStatus: 'SUBMITTED',
          note: 'Returned to queue',
        });
        await audit.record({ actorId: auth.user.id, action: 'kyc.released', entityType: 'kyc_application', entityId: id, ...ctx }, tx);
      });
    },

    async decide(auth, id, input, ctx) {
      const { decision, reason, riskRating, documents = [], screeningCleared = false } = input;
      const message = await prisma.$transaction(async (tx) => {
        const app = await loadApplication(id, tx);
        if (app.userId === auth.user.id) throw new ForbiddenError('You cannot review your own application');
        if (app.status !== 'UNDER_REVIEW') throw new ConflictError('Claim this application before deciding on it', 'NOT_UNDER_REVIEW');
        if (app.reviewerId !== auth.user.id)
          throw new ConflictError('Only the assigned reviewer can decide on this application', 'NOT_ASSIGNED');

        // Apply per-document decisions (documents of this application only).
        const appDocs = await tx.investorDocument.findMany({ where: { applicationId: id, supersededAt: null } });
        for (const d of documents) {
          const doc = appDocs.find((x) => x.id === d.id);
          if (!doc)
            throw new ValidationError([
              {
                location: 'body',
                path: 'documents',
                message: `Document ${d.id} is not part of this application`,
                code: 'unknown_document',
              },
            ]);
          if (d.status === 'REJECTED' && !d.reason)
            throw new ValidationError([
              { location: 'body', path: 'documents', message: 'Give a reason for each rejected document', code: 'reason_required' },
            ]);
          await tx.investorDocument.update({
            where: { id: d.id },
            data: {
              status: d.status,
              rejectionReason: d.status === 'REJECTED' ? d.reason : null,
              reviewerId: auth.user.id,
              reviewedAt: new Date(),
            },
          });
          doc.status = d.status;
        }

        const profile = await tx.investorProfile.findUniqueOrThrow({ where: { userId: app.userId } });
        const required = requiredDocumentTypes({ userType: app.user.type, idType: profile.idType });
        let toStatus;
        let template;
        let profileUpdate;

        if (decision === 'APPROVE') {
          const notAccepted = required.filter((t) => appDocs.find((d) => d.type === t)?.status !== 'ACCEPTED');
          if (notAccepted.length)
            throw new ConflictError(
              `Accept every required document before approving (outstanding: ${notAccepted.join(', ')})`,
              'DOCUMENTS_NOT_ACCEPTED',
            );
          if (!riskRating)
            throw new ValidationError([
              { location: 'body', path: 'riskRating', message: 'Assign a risk rating to approve', code: 'required' },
            ]);
          if (profile.isPoliticallyExposed && riskRating !== 'HIGH') {
            throw new ConflictError(
              'Politically exposed persons require a HIGH risk rating (enhanced due diligence)',
              'PEP_REQUIRES_HIGH_RISK',
            );
          }
          const latestScreening = await tx.screeningResult.findFirst({ where: { applicationId: id }, orderBy: { createdAt: 'desc' } });
          if (!latestScreening || latestScreening.status === 'ERROR')
            throw new ConflictError('Screening has not completed for this application', 'SCREENING_INCOMPLETE');
          if (latestScreening.status === 'POTENTIAL_MATCH' && !screeningCleared) {
            throw new ConflictError(
              'Resolve the potential screening match (confirm it is a false positive) before approving',
              'SCREENING_MATCH_UNRESOLVED',
            );
          }
          toStatus = 'APPROVED';
          template = 'kyc-approved';
          profileUpdate = { kycStatus: 'APPROVED', kycVerifiedAt: new Date(), riskRating };
        } else if (decision === 'REQUEST_RESUBMISSION') {
          toStatus = 'RESUBMISSION_REQUIRED';
          template = 'kyc-resubmission';
          profileUpdate = { kycStatus: 'RESUBMISSION_REQUIRED' };
        } else if (decision === 'REJECT') {
          toStatus = 'REJECTED';
          template = 'kyc-rejected';
          profileUpdate = { kycStatus: 'REJECTED' };
        } else {
          throw new AppError('Unknown decision', { status: 400, code: 'BAD_DECISION' });
        }

        const final = toStatus !== 'RESUBMISSION_REQUIRED';
        await tx.kycApplication.update({
          where: { id },
          data: {
            status: toStatus,
            ...(final
              ? { decidedAt: new Date(), decisionReason: reason, riskRating: riskRating ?? null }
              : { resubmissionNotes: reason, reviewerId: auth.user.id }),
          },
        });
        await tx.investorProfile.update({ where: { userId: app.userId }, data: profileUpdate });
        await event(tx, {
          applicationId: id,
          actorId: auth.user.id,
          fromStatus: 'UNDER_REVIEW',
          toStatus,
          note: [reason, screeningCleared ? 'Screening match cleared as a false positive' : null].filter(Boolean).join(' · '),
        });
        await audit.record(
          {
            actorId: auth.user.id,
            action: `kyc.${decision.toLowerCase()}`,
            entityType: 'kyc_application',
            entityId: id,
            metadata: { riskRating, screeningCleared, documents: documents.map((d) => ({ id: d.id, status: d.status })) },
            ...ctx,
          },
          tx,
        );
        return messaging.queue(tx, {
          userId: app.userId,
          recipient: app.user.email,
          template,
          vars: { firstName: firstName(app.user), notes: reason },
        });
      });
      await messaging.dispatch([message]);
    },
  };
}
