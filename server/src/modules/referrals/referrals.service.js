import { randomInt } from 'node:crypto';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { hmacSha256 } from '../../utils/crypto.js';
import { runLedgerTx } from '../ledger/ledger.service.js';
import { displayAmount, firstNameOf } from '../payments/payment-helpers.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0, I/1
const NETWORK_LOOKBACK_MS = 90 * 86_400_000;

/**
 * Referral programme.
 *
 * - Every investor gets one code. Attribution happens only at registration and can never change.
 * - Rewards follow the campaign that was live when the friend signed up. Campaigns start
 *   inactive and need a second person to activate them (financial promotion review).
 * - A reward is paid only when the friend is identity-verified and has a confirmed
 *   investment of at least the campaign minimum, and the referrer is verified too.
 * - Anti-abuse: self-referral is impossible (DB check), a per-referrer cap applies, and a
 *   friend who signed up from a network the referrer recently used is flagged. Flagged
 *   referrals are never paid automatically; staff review them.
 * - Payment is a ledger entry (Dr 5100 referral rewards expense / Cr referrer wallet),
 *   idempotent per referral, with an append-only reward record.
 */
export function createReferralsService({ prisma, env, ledger, wallets, messaging, audit, logger, monitoring = null }) {
  const ipHash = (ip) => (ip ? hmacSha256(env.SESSION_SECRET, `referral-ip:${ip}`) : null);
  const maskName = (p, email) => (p ? `${p.firstName} ${p.lastName.slice(0, 1)}.` : `${email.slice(0, 2)}…`);

  async function codeFor(userId) {
    const existing = await prisma.referralCode.findUnique({ where: { userId } });
    if (existing) return existing.code;
    for (let i = 0; i < 5; i++) {
      const code = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
      try {
        return (await prisma.referralCode.create({ data: { userId, code } })).code;
      } catch (err) {
        if (err.code !== 'P2002') throw err;
        const raced = await prisma.referralCode.findUnique({ where: { userId } });
        if (raced) return raced.code;
      }
    }
    throw new Error('Could not allocate a referral code');
  }

  async function liveCampaign(tx, at = new Date()) {
    return tx.referralCampaign.findFirst({
      where: { active: true, startsAt: { lte: at }, OR: [{ endsAt: null }, { endsAt: { gt: at } }] },
      orderBy: { startsAt: 'desc' },
    });
  }

  /** Pays a referral inside the caller's ledger transaction. Returns the outbox message for the referrer. */
  async function pay(tx, referral, campaign, postedById = null) {
    const { accounts } = await wallets.ensureWallet(tx, referral.referrerId, campaign.currency);
    const expense = await ledger.systemAccount(tx, 'REFERRAL_EXPENSE', campaign.currency);
    const { entry } = await ledger.post(tx, {
      idempotencyKey: `referral-reward:${referral.id}`,
      type: 'REFERRAL_REWARD',
      description: `Referral reward: ${campaign.name}`,
      referenceType: 'referral',
      referenceId: referral.id,
      postedById,
      lines: [
        { accountId: expense.id, amountMinor: campaign.rewardMinor, memo: 'Referral reward' },
        { accountId: accounts.available.id, amountMinor: -campaign.rewardMinor, memo: 'Referral reward' },
      ],
    });
    const { count } = await tx.referral.updateMany({
      where: { id: referral.id, status: { in: ['PENDING', 'QUALIFIED'] } },
      data: { status: 'REWARDED', qualifiedAt: referral.qualifiedAt ?? new Date() },
    });
    if (count !== 1) throw new ConflictError('This referral was already decided', 'ALREADY_DECIDED');
    await tx.referralReward.create({
      data: {
        referralId: referral.id,
        referrerId: referral.referrerId,
        campaignId: campaign.id,
        amountMinor: campaign.rewardMinor,
        currency: campaign.currency,
        journalEntryId: entry.id,
      },
    });
    await audit.record(
      {
        actorId: postedById,
        action: 'referral.rewarded',
        entityType: 'referral',
        entityId: referral.id,
        metadata: { amountMinor: campaign.rewardMinor.toString(), campaignId: campaign.id },
      },
      tx,
    );
    const referrer = await tx.user.findUnique({ where: { id: referral.referrerId }, select: { email: true } });
    const friend = await tx.userProfile.findUnique({ where: { userId: referral.referredUserId }, select: { firstName: true } });
    return messaging.queue(tx, {
      userId: referral.referrerId,
      recipient: referrer.email,
      template: 'referral-reward',
      vars: {
        firstName: await firstNameOf(tx, referral.referrerId),
        amount: displayAmount(campaign.rewardMinor, campaign.currency),
        friend: friend?.firstName ?? 'Your friend',
      },
    });
  }

  const serializeCampaign = (c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    currency: c.currency,
    reward: { amountMinor: c.rewardMinor.toString(), currency: c.currency },
    minInvestment: { amountMinor: c.minInvestmentMinor.toString(), currency: c.currency },
    maxRewardsPerReferrer: c.maxRewardsPerReferrer,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    active: c.active,
    approvedAt: c.approvedAt,
    createdAt: c.createdAt,
  });

  return {
    codeFor,

    /**
     * Called inside the registration transaction. Unknown codes are ignored silently so
     * registration behaves the same whatever is typed (no code enumeration).
     */
    async attachAtRegistration(tx, { referredUserId, code, ip }) {
      if (!code) return null;
      const owner = await tx.referralCode.findUnique({ where: { code: code.trim().toUpperCase() } });
      if (!owner || owner.userId === referredUserId) return null;
      const signupIpHash = ipHash(ip);
      const flags = [];
      if (signupIpHash) {
        const recent = await tx.loginAttempt.findMany({
          where: { userId: owner.userId, success: true, createdAt: { gte: new Date(Date.now() - NETWORK_LOOKBACK_MS) } },
          select: { ipAddress: true },
          distinct: ['ipAddress'],
          take: 50,
        });
        if (recent.some((r) => ipHash(r.ipAddress) === signupIpHash)) flags.push('SHARED_NETWORK');
      }
      const campaign = await liveCampaign(tx);
      return tx.referral.create({
        data: { referrerId: owner.userId, referredUserId, campaignId: campaign?.id ?? null, flags, signupIpHash },
      });
    },

    /**
     * Re-checks a referred user's referral after a qualifying event (an investment confirmed).
     * Never throws: a referral problem must not affect the investment that triggered it.
     */
    async evaluate(referredUserId) {
      try {
        const referral = await prisma.referral.findUnique({ where: { referredUserId }, include: { campaign: true } });
        if (!referral || referral.status !== 'PENDING') return referral?.status ?? null;
        const c = referral.campaign;
        const decide = (status, note) =>
          prisma.referral.updateMany({ where: { id: referral.id, status: 'PENDING' }, data: { status, decisionNote: note } });
        if (!c || !c.active || (c.endsAt && c.endsAt < referral.createdAt)) {
          await decide('NOT_ELIGIBLE', 'No active referral campaign applied when this friend signed up');
          return 'NOT_ELIGIBLE';
        }
        const [friend, qualifyingOrder] = await Promise.all([
          prisma.investorProfile.findUnique({ where: { userId: referredUserId }, select: { kycStatus: true } }),
          prisma.investmentOrder.findFirst({
            where: {
              userId: referredUserId,
              currency: c.currency,
              confirmEntryId: { not: null },
              amountMinor: { gte: c.minInvestmentMinor },
            },
            select: { id: true },
          }),
        ]);
        if (friend?.kycStatus !== 'APPROVED' || !qualifyingOrder) return 'PENDING';

        if (c.maxRewardsPerReferrer) {
          const paid = await prisma.referralReward.count({ where: { referrerId: referral.referrerId, campaignId: c.id } });
          if (paid >= c.maxRewardsPerReferrer) {
            await decide('NOT_ELIGIBLE', 'The reward limit for this campaign has been reached');
            return 'NOT_ELIGIBLE';
          }
        }
        const referrer = await prisma.user.findUnique({
          where: { id: referral.referrerId },
          select: { status: true, investorProfile: { select: { kycStatus: true } } },
        });
        const referrerOk = referrer?.status === 'ACTIVE' && referrer.investorProfile?.kycStatus === 'APPROVED';
        if (referral.flags.length || !referrerOk) {
          const flags = referrerOk ? referral.flags : [...new Set([...referral.flags, 'REFERRER_NOT_VERIFIED'])];
          await prisma.referral.updateMany({
            where: { id: referral.id, status: 'PENDING' },
            data: { status: 'QUALIFIED', qualifiedAt: new Date(), flags },
          });
          if (referral.flags.length) {
            await monitoring?.raise({
              userId: referral.referrerId,
              rule: 'REFERRAL_ABUSE_SIGNAL',
              severity: 'LOW',
              summary: `Referral held for review: ${referral.flags.join(', ')}`,
              referenceType: 'referral',
              referenceId: referral.id,
              details: { flags: referral.flags, referredUserId: referral.referredUserId },
            });
          }
          return 'QUALIFIED';
        }
        const message = await runLedgerTx(prisma, (tx) => pay(tx, referral, c));
        await messaging.dispatch([message]);
        return 'REWARDED';
      } catch (err) {
        logger?.error({ err, referredUserId }, 'referral evaluation failed; it will be retried on the next qualifying event or by staff');
        return null;
      }
    },

    async overview(userId) {
      const code = await codeFor(userId);
      const [referrals, rewards, campaign] = await Promise.all([
        prisma.referral.findMany({
          where: { referrerId: userId },
          include: { referred: { select: { email: true, profile: { select: { firstName: true, lastName: true } } } }, reward: true },
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
        prisma.referralReward.groupBy({ by: ['currency'], where: { referrerId: userId }, _sum: { amountMinor: true }, _count: true }),
        liveCampaign(prisma),
      ]);
      const counts = referrals.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
      return {
        code,
        link: `${env.APP_BASE_URL}/register?ref=${code}`,
        campaign: campaign && serializeCampaign(campaign),
        stats: {
          total: referrals.length,
          byStatus: counts,
          rewards: rewards.map((r) => ({ currency: r.currency, count: r._count, amountMinor: (r._sum.amountMinor ?? 0n).toString() })),
        },
        // Friends are shown by first name and initial only.
        referrals: referrals.map((r) => ({
          id: r.id,
          friend: maskName(r.referred.profile, r.referred.email),
          status: r.status,
          // Abuse flags are internal and never shown to the referrer; a held referral reads as "being checked".
          note: r.status === 'QUALIFIED' ? 'Being checked by our team' : r.status === 'NOT_ELIGIBLE' ? r.decisionNote : null,
          createdAt: r.createdAt,
          reward: r.reward
            ? { amountMinor: r.reward.amountMinor.toString(), currency: r.reward.currency, paidAt: r.reward.createdAt }
            : null,
        })),
      };
    },

    // ── Staff ──────────────────────────────────────────────────────────────

    async listCampaigns() {
      const rows = await prisma.referralCampaign.findMany({
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { rewards: true, referrals: true } } },
      });
      return rows.map((c) => ({
        ...serializeCampaign(c),
        referrals: c._count.referrals,
        rewardsPaid: c._count.rewards,
        createdById: c.createdById,
      }));
    },

    async createCampaign(auth, input, ctx) {
      if (input.endsAt && input.endsAt <= input.startsAt)
        throw new ValidationError([{ location: 'body', path: 'endsAt', message: 'The end must be after the start' }]);
      const c = await prisma.$transaction(async (tx) => {
        const created = await tx.referralCampaign.create({ data: { ...input, createdById: auth.user.id } });
        await audit.record(
          {
            actorId: auth.user.id,
            action: 'referral_campaign.created',
            entityType: 'referral_campaign',
            entityId: created.id,
            after: serializeCampaign(created),
            ...ctx,
          },
          tx,
        );
        return created;
      });
      return serializeCampaign(c);
    },

    /** Four-eyes: someone other than the creator activates a campaign. */
    async setCampaignActive(auth, id, active, ctx) {
      const c = await prisma.referralCampaign.findUnique({ where: { id } });
      if (!c) throw new NotFoundError('Campaign not found');
      if (active && c.createdById === auth.user.id)
        throw new ForbiddenError('Four-eyes rule: a different person must approve and activate this campaign');
      const updated = await prisma.$transaction(async (tx) => {
        const u = await tx.referralCampaign.update({
          where: { id },
          data: active
            ? { active: true, approvedById: c.approvedById ?? auth.user.id, approvedAt: c.approvedAt ?? new Date() }
            : { active: false },
        });
        await audit.record(
          {
            actorId: auth.user.id,
            action: active ? 'referral_campaign.activated' : 'referral_campaign.deactivated',
            entityType: 'referral_campaign',
            entityId: id,
            ...ctx,
          },
          tx,
        );
        return u;
      });
      return serializeCampaign(updated);
    },

    async listReferrals({ status, page = 1, pageSize = 20 }) {
      const where = status ? { status } : {};
      const person = { select: { email: true, profile: { select: { firstName: true, lastName: true } } } };
      const [total, rows] = await prisma.$transaction([
        prisma.referral.count({ where }),
        prisma.referral.findMany({
          where,
          include: { referrer: person, referred: person, campaign: true, reward: true },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      const who = (u) => ({ email: u.email, name: u.profile ? `${u.profile.firstName} ${u.profile.lastName}` : null });
      return {
        data: rows.map((r) => ({
          id: r.id,
          status: r.status,
          flags: r.flags,
          decisionNote: r.decisionNote,
          referrer: who(r.referrer),
          referred: who(r.referred),
          campaign: r.campaign && { id: r.campaign.id, name: r.campaign.name },
          reward: r.reward ? { amountMinor: r.reward.amountMinor.toString(), currency: r.reward.currency } : null,
          qualifiedAt: r.qualifiedAt,
          createdAt: r.createdAt,
        })),
        meta: { page, pageSize, total },
      };
    },

    /** Staff decision on a held (QUALIFIED) referral: pay it or reject it. */
    async decide(auth, id, { approve, note }, ctx) {
      const referral = await prisma.referral.findUnique({ where: { id }, include: { campaign: true } });
      if (!referral) throw new NotFoundError('Referral not found');
      if (referral.status !== 'QUALIFIED') throw new ConflictError('Only referrals held for review can be decided', 'NOT_HELD');
      if ([referral.referrerId, referral.referredUserId].includes(auth.user.id))
        throw new ForbiddenError('You cannot decide on a referral you are part of');
      if (!approve) {
        await prisma.$transaction(async (tx) => {
          const { count } = await tx.referral.updateMany({
            where: { id, status: 'QUALIFIED' },
            data: { status: 'REJECTED', decisionNote: note },
          });
          if (count !== 1) throw new ConflictError('This referral was already decided', 'ALREADY_DECIDED');
          await audit.record(
            { actorId: auth.user.id, action: 'referral.rejected', entityType: 'referral', entityId: id, metadata: { note }, ...ctx },
            tx,
          );
        });
        return { status: 'REJECTED' };
      }
      if (!referral.campaign) throw new ConflictError('This referral has no campaign to pay from', 'NO_CAMPAIGN');
      const message = await runLedgerTx(prisma, async (tx) => {
        await audit.record(
          {
            actorId: auth.user.id,
            action: 'referral.approved',
            entityType: 'referral',
            entityId: id,
            metadata: { note, flags: referral.flags },
            ...ctx,
          },
          tx,
        );
        return pay(tx, referral, referral.campaign, auth.user.id);
      });
      await messaging.dispatch([message]);
      return { status: 'REWARDED' };
    },
  };
}
