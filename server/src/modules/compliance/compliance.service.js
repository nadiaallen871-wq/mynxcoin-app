import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';

const CLOSED = ['CLOSED_NO_ACTION', 'CLOSED_ACTION_TAKEN'];
const TRANSITIONS = {
  OPEN: ['INVESTIGATING', 'ESCALATED', ...CLOSED],
  INVESTIGATING: ['ESCALATED', ...CLOSED],
  ESCALATED: ['INVESTIGATING', ...CLOSED],
  CLOSED_NO_ACTION: ['INVESTIGATING'],
  CLOSED_ACTION_TAKEN: ['INVESTIGATING'],
};

/**
 * Monitoring alert triage and compliance case management.
 *
 * Cases keep an append-only timeline of notes and actions. Closing a case needs a
 * written outcome (DB check). Regulatory reports are filed outside this system;
 * staff record the reference here. Nothing is reported to a regulator automatically,
 * and having this workflow does not by itself make the platform compliant with any
 * regulation.
 */
export function createComplianceService({ prisma, audit, wallets }) {
  const name = (u) => (u?.profile ? `${u.profile.firstName} ${u.profile.lastName}` : (u?.email ?? null));
  const person = { select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } } };

  const serializeAlert = (a) => ({
    id: a.id,
    rule: a.rule,
    severity: a.severity,
    status: a.status,
    summary: a.summary,
    details: a.details,
    referenceType: a.referenceType,
    referenceId: a.referenceId,
    caseId: a.caseId,
    reviewNote: a.reviewNote,
    reviewedAt: a.reviewedAt,
    reviewedBy: a.reviewedBy ? name(a.reviewedBy) : null,
    subject: a.user && { id: a.user.id, name: name(a.user), email: a.user.email },
    createdAt: a.createdAt,
  });

  const serializeCase = (c) => ({
    id: c.id,
    number: c.number,
    type: c.type,
    status: c.status,
    priority: c.priority,
    title: c.title,
    outcome: c.outcome,
    regulatoryReference: c.regulatoryReference,
    reportedAt: c.reportedAt,
    closedAt: c.closedAt,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    subject: c.subject && { id: c.subject.id, name: name(c.subject), email: c.subject.email },
    assignee: c.assignee ? { id: c.assignee.id, name: name(c.assignee) } : null,
  });

  async function event(tx, caseId, actorId, kind, body = null, data = null) {
    await tx.complianceCaseEvent.create({ data: { caseId, actorId, kind, body, data } });
    await tx.complianceCase.update({ where: { id: caseId }, data: { updatedAt: new Date() } });
  }

  async function loadCase(id) {
    const c = await prisma.complianceCase.findUnique({ where: { id }, include: { subject: person, assignee: person } });
    if (!c) throw new NotFoundError('Case not found');
    return c;
  }

  async function caseView(id) {
    const c = await loadCase(id);
    const [events, alerts, profile, wallets_] = await Promise.all([
      prisma.complianceCaseEvent.findMany({ where: { caseId: id }, include: { actor: person }, orderBy: { id: 'asc' } }),
      prisma.monitoringAlert.findMany({ where: { caseId: id }, orderBy: { createdAt: 'asc' } }),
      prisma.investorProfile.findUnique({
        where: { userId: c.subjectUserId },
        select: { kycStatus: true, riskRating: true, isPoliticallyExposed: true, sourceOfFunds: true, sourceOfFundsDetails: true },
      }),
      prisma.wallet.findMany({ where: { userId: c.subjectUserId }, select: { currency: true, status: true, statusReason: true } }),
    ]);
    return {
      ...serializeCase(c),
      subjectProfile: profile
        ? {
            kycStatus: profile.kycStatus,
            riskRating: profile.riskRating,
            politicallyExposed: profile.isPoliticallyExposed,
            sourceOfFunds: profile.sourceOfFunds,
            sourceOfFundsDetails: profile.sourceOfFundsDetails,
          }
        : null,
      wallets: wallets_,
      alerts: alerts.map(serializeAlert),
      events: events.map((e) => ({
        id: e.id.toString(),
        kind: e.kind,
        body: e.body,
        data: e.data,
        actor: name(e.actor),
        createdAt: e.createdAt,
      })),
    };
  }

  function assertNotSubject(auth, subjectUserId) {
    if (auth.user.id === subjectUserId) throw new ForbiddenError('You cannot handle a case or alert about yourself');
  }

  return {
    // ── Alerts ─────────────────────────────────────────────────────────────

    async listAlerts({ status, severity, rule, userId, page = 1, pageSize = 25 }) {
      const where = {
        ...(status ? { status } : {}),
        ...(severity ? { severity } : {}),
        ...(rule ? { rule } : {}),
        ...(userId ? { userId } : {}),
      };
      const [total, rows] = await prisma.$transaction([
        prisma.monitoringAlert.count({ where }),
        prisma.monitoringAlert.findMany({
          where,
          include: { user: person, reviewedBy: person },
          orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      return { data: rows.map(serializeAlert), meta: { page, pageSize, total } };
    },

    async dismissAlert(auth, id, { note }, ctx) {
      const a = await prisma.monitoringAlert.findUnique({ where: { id } });
      if (!a) throw new NotFoundError('Alert not found');
      assertNotSubject(auth, a.userId);
      await prisma.$transaction(async (tx) => {
        const { count } = await tx.monitoringAlert.updateMany({
          where: { id, status: 'OPEN' },
          data: { status: 'DISMISSED', reviewNote: note, reviewedById: auth.user.id, reviewedAt: new Date() },
        });
        if (count !== 1) throw new ConflictError('This alert was already reviewed', 'ALREADY_REVIEWED');
        await audit.record(
          {
            actorId: auth.user.id,
            action: 'alert.dismissed',
            entityType: 'monitoring_alert',
            entityId: id,
            metadata: { note, rule: a.rule },
            ...ctx,
          },
          tx,
        );
      });
      return { status: 'DISMISSED' };
    },

    /** Escalates an alert into a new case, or links it to an existing open case for the same person. */
    async escalateAlert(auth, id, { caseId, type = 'AML', priority = 'NORMAL', note }, ctx) {
      const a = await prisma.monitoringAlert.findUnique({ where: { id } });
      if (!a) throw new NotFoundError('Alert not found');
      assertNotSubject(auth, a.userId);
      const result = await prisma.$transaction(async (tx) => {
        let c;
        if (caseId) {
          c = await tx.complianceCase.findUnique({ where: { id: caseId } });
          if (!c || c.subjectUserId !== a.userId)
            throw new ValidationError([{ location: 'body', path: 'caseId', message: 'Choose an open case about the same person' }]);
          if (CLOSED.includes(c.status)) throw new ConflictError('That case is closed', 'CASE_CLOSED');
        } else {
          c = await tx.complianceCase.create({
            data: {
              subjectUserId: a.userId,
              type,
              priority: a.severity === 'HIGH' && priority === 'NORMAL' ? 'HIGH' : priority,
              title: a.summary,
              openedById: auth.user.id,
            },
          });
          await event(tx, c.id, auth.user.id, 'OPENED', note, { fromAlert: id });
        }
        const { count } = await tx.monitoringAlert.updateMany({
          where: { id, status: 'OPEN' },
          data: { status: 'ESCALATED', caseId: c.id, reviewNote: note, reviewedById: auth.user.id, reviewedAt: new Date() },
        });
        if (count !== 1) throw new ConflictError('This alert was already reviewed', 'ALREADY_REVIEWED');
        await event(tx, c.id, auth.user.id, 'ALERT_LINKED', `${a.rule}: ${a.summary}`, { alertId: id });
        await audit.record(
          {
            actorId: auth.user.id,
            action: 'alert.escalated',
            entityType: 'monitoring_alert',
            entityId: id,
            metadata: { caseId: c.id },
            ...ctx,
          },
          tx,
        );
        return c;
      });
      return caseView(result.id);
    },

    // ── Cases ──────────────────────────────────────────────────────────────

    async listCases({ status, type, assignee, staffId, page = 1, pageSize = 25 }) {
      const where = {
        ...(status === 'OPEN_ANY' || !status ? { status: { notIn: CLOSED } } : status === 'ALL' ? {} : { status }),
        ...(type ? { type } : {}),
        ...(assignee === 'me' ? { assigneeId: staffId } : assignee === 'unassigned' ? { assigneeId: null } : {}),
      };
      const [total, rows] = await prisma.$transaction([
        prisma.complianceCase.count({ where }),
        prisma.complianceCase.findMany({
          where,
          include: { subject: person, assignee: person },
          orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      return { data: rows.map(serializeCase), meta: { page, pageSize, total } };
    },

    getCase: caseView,

    async openCase(auth, { subjectUserId, type, priority = 'NORMAL', title, note }, ctx) {
      assertNotSubject(auth, subjectUserId);
      const subject = await prisma.user.findUnique({ where: { id: subjectUserId } });
      if (!subject) throw new ValidationError([{ location: 'body', path: 'subjectUserId', message: 'User not found' }]);
      const c = await prisma.$transaction(async (tx) => {
        const created = await tx.complianceCase.create({ data: { subjectUserId, type, priority, title, openedById: auth.user.id } });
        await event(tx, created.id, auth.user.id, 'OPENED', note);
        await audit.record(
          {
            actorId: auth.user.id,
            action: 'case.opened',
            entityType: 'compliance_case',
            entityId: created.id,
            after: { type, priority, subjectUserId },
            ...ctx,
          },
          tx,
        );
        return created;
      });
      return caseView(c.id);
    },

    async addNote(auth, id, { body }) {
      const c = await loadCase(id);
      assertNotSubject(auth, c.subjectUserId);
      await prisma.$transaction((tx) => event(tx, id, auth.user.id, 'NOTE', body));
      return caseView(id);
    },

    async updateCase(auth, id, { status, priority, assigneeId, outcome }, ctx) {
      const c = await loadCase(id);
      assertNotSubject(auth, c.subjectUserId);
      const data = {};
      const changes = [];
      if (status && status !== c.status) {
        if (!TRANSITIONS[c.status].includes(status))
          throw new ConflictError(`A case cannot move from ${c.status} to ${status}`, 'INVALID_TRANSITION');
        if (CLOSED.includes(status) && (outcome ?? c.outcome ?? '').trim().length < 10) {
          throw new ValidationError([
            { location: 'body', path: 'outcome', message: 'Record the outcome before closing (at least 10 characters)' },
          ]);
        }
        data.status = status;
        data.closedAt = CLOSED.includes(status) ? new Date() : null;
        changes.push(['STATUS_CHANGED', `${c.status} → ${status}`]);
      }
      if (outcome !== undefined && outcome !== c.outcome) {
        data.outcome = outcome;
        changes.push(['OUTCOME_RECORDED', outcome]);
      }
      if (priority && priority !== c.priority) {
        data.priority = priority;
        changes.push(['PRIORITY_CHANGED', `${c.priority} → ${priority}`]);
      }
      if (assigneeId !== undefined && assigneeId !== c.assigneeId) {
        if (assigneeId) {
          const ok = await prisma.userRole.findFirst({
            where: {
              userId: assigneeId,
              user: { type: 'STAFF', status: 'ACTIVE' },
              role: { permissions: { some: { permission: { key: 'compliance:cases:manage' } } } },
            },
          });
          if (!ok || assigneeId === c.subjectUserId)
            throw new ValidationError([{ location: 'body', path: 'assigneeId', message: 'Choose an active compliance officer' }]);
        }
        data.assigneeId = assigneeId;
        changes.push(['ASSIGNED', assigneeId ? 'Assigned' : 'Unassigned']);
      }
      if (!changes.length) return caseView(id);
      await prisma.$transaction(async (tx) => {
        await tx.complianceCase.update({ where: { id }, data });
        for (const [kind, body] of changes) await event(tx, id, auth.user.id, kind, body, kind === 'ASSIGNED' ? { assigneeId } : null);
        await audit.record(
          {
            actorId: auth.user.id,
            action: 'case.updated',
            entityType: 'compliance_case',
            entityId: id,
            before: { status: c.status, priority: c.priority, assigneeId: c.assigneeId },
            after: data,
            ...ctx,
          },
          tx,
        );
      });
      return caseView(id);
    },

    /** Records the reference of a report filed with the regulator or FIU outside the system. */
    async recordReport(auth, id, { reference, note }, ctx) {
      const c = await loadCase(id);
      assertNotSubject(auth, c.subjectUserId);
      if (c.regulatoryReference) throw new ConflictError('A report reference is already recorded for this case', 'ALREADY_REPORTED');
      await prisma.$transaction(async (tx) => {
        await tx.complianceCase.update({ where: { id }, data: { regulatoryReference: reference, reportedAt: new Date() } });
        await event(tx, id, auth.user.id, 'REPORT_RECORDED', note ?? null, { reference });
        await audit.record(
          {
            actorId: auth.user.id,
            action: 'case.report_recorded',
            entityType: 'compliance_case',
            entityId: id,
            metadata: { reference },
            ...ctx,
          },
          tx,
        );
      });
      return caseView(id);
    },

    /** Changes the subject's risk classification (affects screening and review depth), with a reason on the case. */
    async setRiskRating(auth, id, { riskRating, reason }, ctx) {
      const c = await loadCase(id);
      assertNotSubject(auth, c.subjectUserId);
      const profile = await prisma.investorProfile.findUnique({ where: { userId: c.subjectUserId } });
      if (!profile) throw new ConflictError('This person has no investor profile', 'NO_PROFILE');
      if (profile.riskRating === riskRating) throw new ConflictError('The risk rating is already set to that value', 'NO_CHANGE');
      await prisma.$transaction(async (tx) => {
        await tx.investorProfile.update({ where: { userId: c.subjectUserId }, data: { riskRating } });
        await event(tx, id, auth.user.id, 'RISK_RATING_CHANGED', reason, { from: profile.riskRating, to: riskRating });
        await audit.record(
          {
            actorId: auth.user.id,
            action: 'investor.risk_rating_changed',
            entityType: 'user',
            entityId: c.subjectUserId,
            before: { riskRating: profile.riskRating },
            after: { riskRating },
            metadata: { caseId: id, reason },
            ...ctx,
          },
          tx,
        );
      });
      return caseView(id);
    },

    /** Freezes or unfreezes the subject's wallet from the case (uses the wallet service, which audits it). */
    async setWalletFrozen(auth, id, { currency = 'GHS', frozen, reason }, ctx) {
      const c = await loadCase(id);
      assertNotSubject(auth, c.subjectUserId);
      await wallets.setStatus(auth, c.subjectUserId, currency, { frozen, reason }, ctx);
      await prisma.$transaction((tx) => event(tx, id, auth.user.id, frozen ? 'WALLET_FROZEN' : 'WALLET_UNFROZEN', reason, { currency }));
      return caseView(id);
    },

    async officers() {
      const rows = await prisma.user.findMany({
        where: {
          type: 'STAFF',
          status: 'ACTIVE',
          roles: { some: { role: { permissions: { some: { permission: { key: 'compliance:cases:manage' } } } } } },
        },
        select: person.select,
        orderBy: { email: 'asc' },
      });
      return rows.map((u) => ({ id: u.id, name: name(u) }));
    },
  };
}
