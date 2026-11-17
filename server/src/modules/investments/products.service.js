import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { fromDecimalString, toDecimalString, toJSON, money } from '../../utils/money.js';
import { ALLOWED_TYPES, detectMimeType, sha256 } from '../documents/file-validation.js';
import { RISK_PROFILE_ORDER } from '../onboarding/onboarding.constants.js';
import { projectInvestment } from './calculator.js';

const PUBLIC_STATUSES = ['PUBLISHED', 'CLOSED'];
const EDITABLE_STATUSES = new Set(['DRAFT', 'SUSPENDED']);
const TERM_REQUIRED_TYPES = new Set(['TREASURY_BILL', 'GOVERNMENT_BOND', 'CORPORATE_BOND', 'FIXED_DEPOSIT']);
const TRANSITIONS = {
  publish: ['DRAFT', 'SUSPENDED'],
  suspend: ['PUBLISHED'],
  close: ['PUBLISHED', 'SUSPENDED'],
  archive: ['DRAFT', 'SUSPENDED', 'CLOSED'],
};

const fieldError = (path, message, code = 'invalid') => new ValidationError([{ location: 'body', path, message, code }]);

/** "12.5" (percent) → Decimal fraction 0.125, exactly. */
const percentToFraction = (pct) => (pct === null || pct === undefined || pct === '' ? null : new Prisma.Decimal(pct).div(100));
/** Decimal fraction → percent string with up to 4 decimal places, trailing zeros trimmed ("12.5"). */
const fractionToPercent = (d) => (d === null || d === undefined ? null : new Prisma.Decimal(d).mul(100).toDecimalPlaces(4).toString());

export function slugify(name) {
  return String(name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

export function availabilityOf(p, now = new Date()) {
  if (p.status === 'CLOSED') return 'CLOSED';
  if (p.status !== 'PUBLISHED') return 'UNAVAILABLE';
  if (p.subscriptionOpensAt && p.subscriptionOpensAt > now) return 'UPCOMING';
  if (p.subscriptionClosesAt && p.subscriptionClosesAt <= now) return 'CLOSED';
  return 'OPEN';
}

/**
 * Investment products: public catalogue, eligibility, illustrative calculator,
 * and staff management with a controlled lifecycle.
 *
 * Integrity rules:
 * - Published terms are immutable. To change them, suspend, edit, then republish.
 *   Every publication stores an immutable version snapshot.
 * - Four-eyes: the person who publishes cannot be the last person who edited.
 * - Historical performance is shown only with a recorded source and is append-only.
 *   Nothing is projected from history.
 */
export function createProductsService({ prisma, storage, audit }) {
  async function exponents() {
    const rows = await prisma.currency.findMany({ select: { code: true, minorUnits: true, isActive: true } });
    return Object.fromEntries(rows.map((c) => [c.code, c]));
  }

  async function toMinor(value, currency, path) {
    if (value === null || value === undefined || value === '') return null;
    const all = await exponents();
    if (!all[currency]) throw fieldError('currency', 'Unknown currency');
    try {
      return fromDecimalString(String(value), currency, { [currency]: all[currency].minorUnits }).minor;
    } catch (err) {
      throw fieldError(path, err.message);
    }
  }

  const amount = (minor, currency, minorUnits) =>
    minor === null || minor === undefined
      ? null
      : { ...toJSON(money(minor, currency)), decimal: toDecimalString(money(minor, currency), { [currency]: minorUnits }) };

  function serialize(p, { staff = false } = {}) {
    const units = p.currencyRef?.minorUnits ?? 2;
    const base = {
      id: p.id,
      slug: p.slug,
      name: p.name,
      shortDescription: p.shortDescription,
      description: p.description,
      category: p.category && { slug: p.category.slug, name: p.category.name },
      productType: p.productType,
      issuerName: p.issuerName,
      currency: p.currency,
      minInvestment: amount(p.minInvestmentMinor, p.currency, units),
      maxInvestment: amount(p.maxInvestmentMinor, p.currency, units),
      increment: amount(p.incrementMinor, p.currency, units),
      capacity: amount(p.capacityMinor, p.currency, units),
      returnType: p.returnType,
      annualRatePercent: fractionToPercent(p.annualRate),
      termDays: p.termDays,
      maturityDate: p.maturityDate ? p.maturityDate.toISOString().slice(0, 10) : null,
      lockupDays: p.lockupDays,
      redemptionTerms: p.redemptionTerms,
      fees: {
        entryPercent: fractionToPercent(p.entryFeeRate),
        managementPercent: fractionToPercent(p.managementFeeRate),
        earlyExitPercent: fractionToPercent(p.earlyExitFeeRate),
        notes: p.feeNotes,
      },
      riskLevel: p.riskLevel,
      minRiskProfile: p.minRiskProfile,
      riskDisclosure: p.riskDisclosure,
      eligibleInvestorTypes: p.eligibleInvestorTypes,
      subscriptionOpensAt: p.subscriptionOpensAt,
      subscriptionClosesAt: p.subscriptionClosesAt,
      status: p.status,
      availability: availabilityOf(p),
      publishedAt: p.publishedAt,
      version: p.version,
      documents: (p.documents ?? []).map((d) => ({ id: d.id, kind: d.kind, title: d.title, mimeType: d.mimeType, sizeBytes: d.sizeBytes })),
      performance: (p.performance ?? []).map((r) => ({
        id: r.id,
        periodStart: r.periodStart.toISOString().slice(0, 10),
        periodEnd: r.periodEnd.toISOString().slice(0, 10),
        returnPercent: fractionToPercent(r.returnRate),
        source: r.source,
        sourceUrl: r.sourceUrl,
      })),
    };
    if (!staff) return base;
    return {
      ...base,
      statusReason: p.statusReason,
      createdBy: p.createdBy && personName(p.createdBy),
      updatedBy: p.updatedBy && { id: p.updatedById, name: personName(p.updatedBy) },
      publishedBy: p.publishedBy && personName(p.publishedBy),
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      versions: (p.versions ?? []).map((v) => ({
        version: v.version,
        publishedAt: v.createdAt,
        publishedBy: v.publishedBy && personName(v.publishedBy),
      })),
    };
  }

  const personName = (u) => (u.profile ? `${u.profile.firstName} ${u.profile.lastName}` : u.email);

  const detailInclude = (staff) => ({
    category: true,
    currencyRef: { select: { minorUnits: true } },
    documents: { orderBy: { createdAt: 'asc' } },
    performance: { orderBy: { periodEnd: 'desc' } },
    ...(staff
      ? {
          createdBy: { select: { email: true, profile: { select: { firstName: true, lastName: true } } } },
          updatedBy: { select: { email: true, profile: { select: { firstName: true, lastName: true } } } },
          publishedBy: { select: { email: true, profile: { select: { firstName: true, lastName: true } } } },
          versions: {
            orderBy: { version: 'desc' },
            include: { publishedBy: { select: { email: true, profile: { select: { firstName: true, lastName: true } } } } },
          },
        }
      : {}),
  });

  /** Converts validated API input (decimal amounts, percent rates) into column values and checks cross-field rules. */
  async function toColumns(input, existing = {}) {
    const merged = { ...existing, ...input };
    const currency = merged.currency;
    const data = {};
    const copy = [
      'name',
      'shortDescription',
      'description',
      'productType',
      'issuerName',
      'currency',
      'returnType',
      'termDays',
      'lockupDays',
      'redemptionTerms',
      'feeNotes',
      'riskLevel',
      'minRiskProfile',
      'riskDisclosure',
      'eligibleInvestorTypes',
    ];
    for (const key of copy) if (key in input) data[key] = input[key];
    if ('categorySlug' in input) {
      const category = await prisma.investmentCategory.findUnique({ where: { slug: input.categorySlug } });
      if (!category) throw fieldError('categorySlug', 'Unknown category');
      data.categoryId = category.id;
    }
    for (const [field, column] of [
      ['minInvestment', 'minInvestmentMinor'],
      ['maxInvestment', 'maxInvestmentMinor'],
      ['increment', 'incrementMinor'],
      ['capacity', 'capacityMinor'],
    ]) {
      if (field in input) data[column] = await toMinor(input[field], currency, field);
    }
    if ('annualRatePercent' in input) data.annualRate = percentToFraction(input.annualRatePercent);
    if ('entryFeePercent' in input) data.entryFeeRate = percentToFraction(input.entryFeePercent) ?? 0;
    if ('managementFeePercent' in input) data.managementFeeRate = percentToFraction(input.managementFeePercent) ?? 0;
    if ('earlyExitFeePercent' in input) data.earlyExitFeeRate = percentToFraction(input.earlyExitFeePercent) ?? 0;
    for (const key of ['maturityDate']) if (key in input) data[key] = input[key] ? new Date(`${input[key]}T00:00:00.000Z`) : null;
    for (const key of ['subscriptionOpensAt', 'subscriptionClosesAt'])
      if (key in input) data[key] = input[key] ? new Date(input[key]) : null;

    // Cross-field rules against the resulting row.
    const row = { ...existing, ...data };
    if ((row.returnType === 'NONE') !== (row.annualRate === null || row.annualRate === undefined)) {
      throw fieldError(
        'annualRatePercent',
        row.returnType === 'NONE'
          ? 'Remove the rate for products without a stated return'
          : 'Enter the annual rate for fixed or target-return products',
      );
    }
    if (row.maxInvestmentMinor !== null && row.maxInvestmentMinor !== undefined && row.maxInvestmentMinor < row.minInvestmentMinor) {
      throw fieldError('maxInvestment', 'Maximum must be at least the minimum');
    }
    if (row.capacityMinor !== null && row.capacityMinor !== undefined && row.capacityMinor < row.minInvestmentMinor) {
      throw fieldError('capacity', 'Capacity must be at least the minimum investment');
    }
    if (row.subscriptionOpensAt && row.subscriptionClosesAt && row.subscriptionClosesAt <= row.subscriptionOpensAt) {
      throw fieldError('subscriptionClosesAt', 'The closing date must be after the opening date');
    }
    return data;
  }

  function assertPublishable(p) {
    const problems = [];
    if (p.description.length < 100) problems.push(['description', 'Write a description of at least 100 characters']);
    if (p.riskDisclosure.length < 100)
      problems.push(['riskDisclosure', 'Write a product-specific risk disclosure of at least 100 characters']);
    if (TERM_REQUIRED_TYPES.has(p.productType) && !p.termDays) problems.push(['termDays', 'Fixed-term products need a term']);
    if (!p.documents.some((d) => ['KEY_INFORMATION', 'TERM_SHEET'].includes(d.kind)))
      problems.push(['documents', 'Attach a key information document or term sheet']);
    if (!p.category.isActive) problems.push(['categorySlug', 'The category is inactive']);
    if (!p.currencyRef.isActive) problems.push(['currency', 'The currency is not enabled on the platform']);
    if (problems.length) {
      throw new ValidationError(
        problems.map(([path, message]) => ({ location: 'body', path, message, code: 'not_publishable' })),
        'This product is not ready to publish',
      );
    }
  }

  async function loadForUpdate(tx, id) {
    const p = await tx.investmentProduct.findUnique({ where: { id }, include: { documents: true, category: true, currencyRef: true } });
    if (!p) throw new NotFoundError('Product not found');
    return p;
  }

  return {
    serialize,

    // ── Public catalogue ──────────────────────────────────────────────────

    async categories() {
      const rows = await prisma.investmentCategory.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: { _count: { select: { products: { where: { status: 'PUBLISHED' } } } } },
      });
      return rows.map((c) => ({ slug: c.slug, name: c.name, description: c.description, productCount: c._count.products }));
    },

    async listPublic({ search, category, type, maxRiskLevel, currency, availability, sort, page, pageSize }) {
      const now = new Date();
      const where = {
        status: availability === 'CLOSED' ? { in: PUBLIC_STATUSES } : availability ? 'PUBLISHED' : { in: PUBLIC_STATUSES },
        ...(category ? { category: { slug: category } } : {}),
        ...(type ? { productType: type } : {}),
        ...(maxRiskLevel ? { riskLevel: { lte: maxRiskLevel } } : {}),
        ...(currency ? { currency } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { issuerName: { contains: search, mode: 'insensitive' } },
                { shortDescription: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(availability === 'OPEN'
          ? {
              AND: [
                { OR: [{ subscriptionOpensAt: null }, { subscriptionOpensAt: { lte: now } }] },
                { OR: [{ subscriptionClosesAt: null }, { subscriptionClosesAt: { gt: now } }] },
              ],
            }
          : availability === 'UPCOMING'
            ? { subscriptionOpensAt: { gt: now } }
            : availability === 'CLOSED'
              ? { OR: [{ status: 'CLOSED' }, { subscriptionClosesAt: { lte: now } }] }
              : {}),
      };
      const orderBy = {
        newest: [{ publishedAt: 'desc' }],
        name: [{ name: 'asc' }],
        min_investment: [{ minInvestmentMinor: 'asc' }, { name: 'asc' }],
        risk_low: [{ riskLevel: 'asc' }, { name: 'asc' }],
        risk_high: [{ riskLevel: 'desc' }, { name: 'asc' }],
        term: [{ termDays: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
        closing: [{ subscriptionClosesAt: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
      }[sort ?? 'newest'];
      const [total, rows] = await prisma.$transaction([
        prisma.investmentProduct.count({ where }),
        prisma.investmentProduct.findMany({
          where,
          orderBy,
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { category: true, currencyRef: { select: { minorUnits: true } } },
        }),
      ]);
      return {
        data: rows.map((p) => {
          const {
            description: _d,
            riskDisclosure: _r,
            documents: _docs,
            performance: _perf,
            redemptionTerms: _t,
            ...summary
          } = serialize(p);
          return summary;
        }),
        meta: { page, pageSize, total },
      };
    },

    async getPublic(slug, auth) {
      const p = await prisma.investmentProduct.findFirst({
        where: { slug, status: { in: PUBLIC_STATUSES } },
        include: detailInclude(false),
      });
      if (!p) throw new NotFoundError('Investment not found');
      return { ...serialize(p), eligibility: await this.eligibility(auth, p) };
    },

    /**
     * Whether the signed-in investor can subscribe, and why not. The order endpoint
     * re-checks everything. This is guidance for the UI.
     */
    async eligibility(auth, p) {
      const checks = [];
      const signedIn = Boolean(auth && !auth.mfaPending);
      checks.push({ key: 'signedIn', ok: signedIn, message: signedIn ? 'Signed in' : 'Sign in or open an account' });
      let profile = null;
      let risk = null;
      if (signedIn) {
        [profile, risk] = await Promise.all([
          prisma.investorProfile.findUnique({ where: { userId: auth.user.id }, select: { kycStatus: true } }),
          prisma.riskAssessment.findFirst({
            where: { userId: auth.user.id },
            orderBy: { createdAt: 'desc' },
            select: { riskProfile: true },
          }),
        ]);
        const verified = profile?.kycStatus === 'APPROVED';
        checks.push({ key: 'verified', ok: verified, message: verified ? 'Identity verified' : 'Complete identity verification' });
        const typeOk = p.eligibleInvestorTypes.includes(auth.user.type);
        checks.push({
          key: 'investorType',
          ok: typeOk,
          message: typeOk ? 'Available to your account type' : 'Not available to your account type',
        });
      }
      const availability = availabilityOf(p);
      checks.push({
        key: 'subscriptionOpen',
        ok: availability === 'OPEN',
        message: {
          OPEN: 'Open for subscription',
          UPCOMING: 'Subscriptions have not opened yet',
          CLOSED: 'Closed to new investment',
          UNAVAILABLE: 'Not available',
        }[availability],
      });
      let suitability = null;
      if (risk) {
        const suitable = RISK_PROFILE_ORDER.indexOf(risk.riskProfile) >= RISK_PROFILE_ORDER.indexOf(p.minRiskProfile);
        suitability = { investorProfile: risk.riskProfile, productMinimum: p.minRiskProfile, suitable };
      }
      return {
        eligible: checks.every((c) => c.ok),
        checks,
        suitability,
        ordersAvailable: true,
        notice: 'Sandbox: orders use simulated wallet money. No real money is accepted.',
      };
    },

    async documentFile(slug, docId) {
      const doc = await prisma.productDocument.findFirst({ where: { id: docId, product: { slug, status: { in: PUBLIC_STATUSES } } } });
      if (!doc) throw new NotFoundError('Document not found');
      const buffer = await storage.get(doc.storageKey);
      if (sha256(buffer) !== doc.sha256) throw new AppError('Document integrity check failed', { status: 500, code: 'DOCUMENT_INTEGRITY' });
      return { buffer, mimeType: doc.mimeType, filename: `${slugify(doc.title) || 'document'}.${ALLOWED_TYPES[doc.mimeType].ext}` };
    },

    /** Illustrative projection for a published product, or for custom terms. */
    async calculate({
      slug,
      amount: amountInput,
      days,
      annualRatePercent,
      currency = 'GHS',
      entryFeePercent = '0',
      managementFeePercent = '0',
    }) {
      let terms;
      if (slug) {
        const p = await prisma.investmentProduct.findFirst({ where: { slug, status: { in: PUBLIC_STATUSES } } });
        if (!p) throw new NotFoundError('Investment not found');
        const period = p.termDays ?? days;
        if (!period) throw fieldError('days', 'Enter how long you plan to invest');
        terms = {
          currency: p.currency,
          annualRate: p.annualRate?.toString() ?? null,
          days: period,
          entryFeeRate: p.entryFeeRate.toString(),
          managementFeeRate: p.managementFeeRate.toString(),
          returnType: p.returnType,
          minInvestmentMinor: p.minInvestmentMinor,
          maxInvestmentMinor: p.maxInvestmentMinor,
        };
      } else {
        if (!days) throw fieldError('days', 'Enter how long you plan to invest');
        terms = {
          currency,
          annualRate: percentToFraction(annualRatePercent)?.toString() ?? null,
          days,
          entryFeeRate: percentToFraction(entryFeePercent).toString(),
          managementFeeRate: percentToFraction(managementFeePercent).toString(),
          returnType: annualRatePercent ? 'TARGET' : 'NONE',
        };
      }
      const amountMinor = await toMinor(amountInput, terms.currency, 'amount');
      if (!amountMinor || amountMinor <= 0n) throw fieldError('amount', 'Enter an amount greater than zero');
      if (terms.minInvestmentMinor && amountMinor < terms.minInvestmentMinor)
        throw fieldError('amount', 'The amount is below the minimum investment for this product');
      if (terms.maxInvestmentMinor && amountMinor > terms.maxInvestmentMinor)
        throw fieldError('amount', 'The amount is above the maximum investment for this product');
      // Normalise "0.1250000000" to a plain (non-exponential) decimal string for exact parsing.
      // decimal.js toFixed() is exact string arithmetic, not the float Number#toFixed the lint rule targets.
      // eslint-disable-next-line no-restricted-properties
      const clean = (r) => (r === null ? null : new Prisma.Decimal(r).toFixed());
      return projectInvestment({
        amountMinor,
        currency: terms.currency,
        annualRate: clean(terms.annualRate),
        days: terms.days,
        entryFeeRate: clean(terms.entryFeeRate),
        managementFeeRate: clean(terms.managementFeeRate),
        returnType: terms.returnType,
      });
    },

    // ── Staff management ──────────────────────────────────────────────────

    async listAll({ status, search, page, pageSize }) {
      const where = {
        ...(status ? { status } : {}),
        ...(search
          ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { issuerName: { contains: search, mode: 'insensitive' } }] }
          : {}),
      };
      const [total, rows, counts] = await prisma.$transaction([
        prisma.investmentProduct.count({ where }),
        prisma.investmentProduct.findMany({
          where,
          orderBy: { updatedAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { category: true, currencyRef: { select: { minorUnits: true } } },
        }),
        prisma.investmentProduct.groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } }),
      ]);
      return {
        data: rows.map((p) => serialize(p, { staff: true })),
        meta: { page, pageSize, total, counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) },
      };
    },

    async get(id) {
      const p = await prisma.investmentProduct.findUnique({ where: { id }, include: detailInclude(true) });
      if (!p) throw new NotFoundError('Product not found');
      return serialize(p, { staff: true });
    },

    async create(auth, input, ctx) {
      const slug = input.slug ?? slugify(input.name);
      if (!slug) throw fieldError('slug', 'Choose a URL name using letters and numbers');
      const data = await toColumns(input, { returnType: input.returnType, currency: input.currency, annualRate: null });
      try {
        const created = await prisma.$transaction(async (tx) => {
          const p = await tx.investmentProduct.create({ data: { ...data, slug, createdById: auth.user.id, updatedById: auth.user.id } });
          await audit.record(
            {
              actorId: auth.user.id,
              action: 'product.created',
              entityType: 'investment_product',
              entityId: p.id,
              after: { slug, name: p.name },
              ...ctx,
            },
            tx,
          );
          return p;
        });
        return this.get(created.id);
      } catch (err) {
        if (err.code === 'P2002') throw new ConflictError('A product with this URL name already exists', 'SLUG_TAKEN');
        throw err;
      }
    },

    async update(auth, id, input, ctx) {
      await prisma.$transaction(async (tx) => {
        const existing = await loadForUpdate(tx, id);
        if (!EDITABLE_STATUSES.has(existing.status)) {
          throw new ConflictError(
            'Published terms cannot be changed. Suspend the product first, then edit and republish it.',
            'PRODUCT_NOT_EDITABLE',
          );
        }
        // Amounts are stored in minor units of the currency, so a currency change must come with re-entered amounts.
        if (input.currency && input.currency !== existing.currency) {
          const amountFields = ['minInvestment', 'maxInvestment', 'increment', 'capacity'].filter(
            (k, i) =>
              k in input ||
              [existing.minInvestmentMinor, existing.maxInvestmentMinor, existing.incrementMinor, existing.capacityMinor][i] === null,
          );
          if (amountFields.length !== 4) throw fieldError('currency', 'Re-enter every amount when changing currency');
        }
        const data = await toColumns(input, existing);
        await tx.investmentProduct.update({ where: { id }, data: { ...data, updatedById: auth.user.id } });
        await audit.record(
          {
            actorId: auth.user.id,
            action: 'product.updated',
            entityType: 'investment_product',
            entityId: id,
            metadata: { fields: Object.keys(input) },
            ...ctx,
          },
          tx,
        );
      });
      return this.get(id);
    },

    async transition(auth, id, action, { reason } = {}, ctx) {
      await prisma.$transaction(async (tx) => {
        const p = await loadForUpdate(tx, id);
        if (!TRANSITIONS[action].includes(p.status)) {
          throw new ConflictError(
            `A ${p.status.toLowerCase()} product cannot be ${{ publish: 'published', suspend: 'suspended', close: 'closed', archive: 'archived' }[action]}`,
            'INVALID_TRANSITION',
          );
        }
        let data;
        if (action === 'publish') {
          if (p.updatedById === auth.user.id) {
            throw new ForbiddenError('Four-eyes rule: a different person must publish the changes you made');
          }
          assertPublishable(p);
          const version = p.version + 1;
          const { documents, category, currencyRef: _c, ...terms } = p;
          await tx.productVersion.create({
            data: {
              productId: id,
              version,
              publishedById: auth.user.id,
              snapshot: JSON.parse(
                JSON.stringify(
                  { ...terms, category: category.slug, documents: documents.map((d) => ({ id: d.id, kind: d.kind, sha256: d.sha256 })) },
                  (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
                ),
              ),
            },
          });
          data = { status: 'PUBLISHED', version, publishedAt: new Date(), publishedById: auth.user.id, statusReason: null };
        } else if (action === 'suspend') {
          data = { status: 'SUSPENDED', statusReason: reason };
        } else if (action === 'close') {
          data = { status: 'CLOSED', statusReason: reason ?? null };
        } else {
          data = { status: 'ARCHIVED', statusReason: reason ?? null };
        }
        await tx.investmentProduct.update({ where: { id }, data });
        const past = { publish: 'published', suspend: 'suspended', close: 'closed', archive: 'archived' }[action];
        await audit.record(
          {
            actorId: auth.user.id,
            action: `product.${past}`,
            entityType: 'investment_product',
            entityId: id,
            before: { status: p.status },
            after: { status: data.status },
            metadata: { reason },
            ...ctx,
          },
          tx,
        );
      });
      return this.get(id);
    },

    async addDocument(auth, id, { kind, title, file }, ctx) {
      const p = await prisma.investmentProduct.findUnique({ where: { id } });
      if (!p) throw new NotFoundError('Product not found');
      if (!EDITABLE_STATUSES.has(p.status))
        throw new ConflictError('Documents can only change while the product is a draft or suspended', 'PRODUCT_NOT_EDITABLE');
      if (!file?.buffer?.length) throw new AppError('Choose a file to upload', { status: 400, code: 'FILE_REQUIRED' });
      const mimeType = detectMimeType(file.buffer);
      if (mimeType !== 'application/pdf')
        throw new AppError('Product documents must be PDF files', { status: 415, code: 'UNSUPPORTED_FILE_TYPE' });
      const storageKey = `products/${id}/${randomUUID()}.pdf`;
      await storage.put(storageKey, file.buffer);
      try {
        await prisma.$transaction(async (tx) => {
          const doc = await tx.productDocument.create({
            data: { productId: id, kind, title, storageKey, mimeType, sizeBytes: file.buffer.length, sha256: sha256(file.buffer) },
          });
          await tx.investmentProduct.update({ where: { id }, data: { updatedById: auth.user.id } });
          await audit.record(
            {
              actorId: auth.user.id,
              action: 'product.document_added',
              entityType: 'investment_product',
              entityId: id,
              metadata: { documentId: doc.id, kind },
              ...ctx,
            },
            tx,
          );
        });
      } catch (err) {
        await storage.delete(storageKey).catch(() => {});
        throw err;
      }
      return this.get(id);
    },

    async removeDocument(auth, id, docId, ctx) {
      const doc = await prisma.productDocument.findFirst({ where: { id: docId, productId: id }, include: { product: true } });
      if (!doc) throw new NotFoundError('Document not found');
      if (doc.product.status !== 'DRAFT') {
        throw new ConflictError(
          'Documents of a product that has been published are retained. Upload a replacement instead.',
          'DOCUMENT_RETAINED',
        );
      }
      await prisma.$transaction(async (tx) => {
        await tx.productDocument.delete({ where: { id: docId } });
        await tx.investmentProduct.update({ where: { id }, data: { updatedById: auth.user.id } });
        await audit.record(
          {
            actorId: auth.user.id,
            action: 'product.document_removed',
            entityType: 'investment_product',
            entityId: id,
            metadata: { documentId: docId },
            ...ctx,
          },
          tx,
        );
      });
      await storage.delete(doc.storageKey);
      return this.get(id);
    },

    async addPerformance(auth, id, input, ctx) {
      const p = await prisma.investmentProduct.findUnique({ where: { id } });
      if (!p) throw new NotFoundError('Product not found');
      const start = new Date(`${input.periodStart}T00:00:00.000Z`);
      const end = new Date(`${input.periodEnd}T00:00:00.000Z`);
      if (end <= start) throw fieldError('periodEnd', 'The period must end after it starts');
      if (end > new Date()) throw fieldError('periodEnd', 'Performance can only be recorded for completed periods');
      try {
        await prisma.$transaction(async (tx) => {
          const rec = await tx.performanceRecord.create({
            data: {
              productId: id,
              periodStart: start,
              periodEnd: end,
              returnRate: percentToFraction(input.returnPercent),
              source: input.source,
              sourceUrl: input.sourceUrl ?? null,
              recordedById: auth.user.id,
            },
          });
          await audit.record(
            {
              actorId: auth.user.id,
              action: 'product.performance_recorded',
              entityType: 'investment_product',
              entityId: id,
              metadata: { recordId: rec.id, returnPercent: input.returnPercent, source: input.source },
              ...ctx,
            },
            tx,
          );
        });
      } catch (err) {
        if (err.code === 'P2002') throw new ConflictError('Performance for this period is already recorded', 'PERIOD_EXISTS');
        throw err;
      }
      return this.get(id);
    },

    async listAllCategories() {
      const rows = await prisma.investmentCategory.findMany({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: { _count: { select: { products: true } } },
      });
      return rows.map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        description: c.description,
        sortOrder: c.sortOrder,
        isActive: c.isActive,
        productCount: c._count.products,
      }));
    },

    async createCategory(auth, input, ctx) {
      const slug = input.slug ?? slugify(input.name);
      try {
        const c = await prisma.$transaction(async (tx) => {
          const row = await tx.investmentCategory.create({
            data: { slug, name: input.name, description: input.description ?? null, sortOrder: input.sortOrder ?? 0 },
          });
          await audit.record(
            {
              actorId: auth.user.id,
              action: 'category.created',
              entityType: 'investment_category',
              entityId: row.id,
              after: { slug, name: row.name },
              ...ctx,
            },
            tx,
          );
          return row;
        });
        return c;
      } catch (err) {
        if (err.code === 'P2002') throw new ConflictError('A category with this URL name already exists', 'SLUG_TAKEN');
        throw err;
      }
    },

    async updateCategory(auth, id, input, ctx) {
      return prisma.$transaction(async (tx) => {
        const before = await tx.investmentCategory.findUnique({ where: { id } });
        if (!before) throw new NotFoundError('Category not found');
        const row = await tx.investmentCategory.update({ where: { id }, data: input });
        await audit.record(
          {
            actorId: auth.user.id,
            action: 'category.updated',
            entityType: 'investment_category',
            entityId: id,
            before: { name: before.name, isActive: before.isActive },
            after: input,
            ...ctx,
          },
          tx,
        );
        return row;
      });
    },
  };
}
