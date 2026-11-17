import { randomUUID } from 'node:crypto';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { money, toDecimalString } from '../../utils/money.js';
import { createPdf, toCsv } from '../../utils/pdf.js';
import { sha256 } from '../documents/file-validation.js';

const DAY_MS = 86_400_000;
const isoDay = (d) => d.toISOString().slice(0, 10);

/** Human labels for journal entry types on statements. */
export const ENTRY_LABELS = {
  DEPOSIT: 'Deposit',
  WITHDRAWAL_REQUEST: 'Withdrawal',
  WITHDRAWAL_RETURN: 'Withdrawal returned',
  WITHDRAWAL: 'Withdrawal paid out',
  RESERVATION: 'Reserved for order',
  RELEASE: 'Order reservation released',
  INVESTMENT_CONFIRMATION: 'Investment',
  MATURITY: 'Maturity proceeds',
  REFERRAL_REWARD: 'Referral reward',
  ADJUSTMENT: 'Adjustment',
  REVERSAL: 'Reversal',
};

const KIND_TITLES = {
  ACCOUNT_STATEMENT: 'Account statement',
  PORTFOLIO_STATEMENT: 'Portfolio statement',
  TRANSACTION_REPORT: 'Transaction report',
  INVESTMENT_CONFIRMATION: 'Investment confirmation',
  DEPOSIT_RECEIPT: 'Deposit receipt',
  WITHDRAWAL_RECEIPT: 'Withdrawal receipt',
  TAX_STATEMENT: 'Tax statement',
};

/** "GHS 1,234.56" (WinAnsi-safe, so no cedi sign in PDFs). */
export function formatAmount(minor, currency) {
  const s = toDecimalString(money(minor, currency));
  const negative = s.startsWith('-');
  const [whole, fraction] = (negative ? s.slice(1) : s).split('.');
  return `${negative ? '-' : ''}${currency} ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction ? `.${fraction}` : ''}`;
}

/**
 * Statements, reports, confirmations and receipts, generated from ledger and
 * order records. Every file is stored encrypted, never changes, and gets a new
 * version if the same scope is generated again. Downloads go through
 * short-lived signed URLs bound to the requesting user, and every generation,
 * URL issue and download is logged.
 */
export function createStatementsService({ prisma, storage, signer, portfolio, audit, tax = null, sandbox = true }) {
  const disclaimer = sandbox
    ? 'SANDBOX: generated from simulated transactions. No real money was moved. Not a regulated statement.'
    : 'Generated from the Mynx ledger. Values marked estimated are not guaranteed until settled.';

  async function person(userId) {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, profile: { select: { firstName: true, lastName: true } } },
    });
    return { name: u?.profile ? `${u.profile.firstName} ${u.profile.lastName}` : u?.email, email: u?.email };
  }

  const header = (pdf, title, who, lines) => {
    pdf.text('MYNX', { size: 9, bold: true, gray: 0.35 }).heading(title);
    pdf.pairs([['Account holder', who.name], ['Email', who.email], ...lines]);
    pdf.space(4).text(disclaimer, { size: 8, gray: 0.4 }).rule();
  };

  async function walletLines(userId, currency, purposes, from, to) {
    const [opening, lines] = await Promise.all([
      prisma.journalLine.groupBy({
        by: ['accountId'],
        where: { account: { ownerUserId: userId, currency, purpose: { in: purposes } }, entry: { postedAt: { lt: from } } },
        _sum: { amountMinor: true },
      }),
      prisma.journalLine.findMany({
        where: { account: { ownerUserId: userId, currency, purpose: { in: purposes } }, entry: { postedAt: { gte: from, lt: to } } },
        include: {
          entry: { select: { entryNumber: true, type: true, description: true, postedAt: true } },
          account: { select: { purpose: true } },
        },
        orderBy: { id: 'asc' },
      }),
    ]);
    const openingMinor = -opening.reduce((a, g) => a + (g._sum.amountMinor ?? 0n), 0n);
    return { openingMinor, lines };
  }

  const builders = {
    async ACCOUNT_STATEMENT(userId, { currency, from, to, format }) {
      const { openingMinor, lines } = await walletLines(userId, currency, ['CUSTOMER_AVAILABLE'], from, to);
      let running = openingMinor;
      const rows = lines.map((l) => {
        running += -l.amountMinor;
        return {
          date: isoDay(l.entry.postedAt),
          ref: l.entry.entryNumber.toString(),
          type: ENTRY_LABELS[l.entry.type] ?? l.entry.type,
          description: l.entry.description,
          amount: -l.amountMinor,
          balance: running,
        };
      });
      const credits = rows.filter((r) => r.amount > 0n).reduce((a, r) => a + r.amount, 0n);
      const debits = rows.filter((r) => r.amount < 0n).reduce((a, r) => a - r.amount, 0n);
      const period = `${isoDay(from)} to ${isoDay(new Date(to - DAY_MS))}`;
      if (format === 'CSV') {
        return toCsv([
          ['Date', 'Reference', 'Type', 'Description', `Amount (${currency})`, `Balance (${currency})`],
          ['', '', 'Opening balance', period, '', toDecimalString(money(openingMinor, currency))],
          ...rows.map((r) => [
            r.date,
            r.ref,
            r.type,
            r.description,
            toDecimalString(money(r.amount, currency)),
            toDecimalString(money(r.balance, currency)),
          ]),
          ['', '', 'Closing balance', '', '', toDecimalString(money(running, currency))],
        ]);
      }
      const who = await person(userId);
      const pdf = createPdf({ title: `Account statement ${period}`, footer: `Account statement ${period}` });
      header(pdf, 'Account statement', who, [
        ['Period', period],
        ['Wallet', `${currency} available balance`],
      ]);
      pdf.pairs([
        ['Opening balance', formatAmount(openingMinor, currency)],
        ['Money in', formatAmount(credits, currency)],
        ['Money out', formatAmount(debits, currency)],
        ['Closing balance', formatAmount(running, currency)],
      ]);
      pdf
        .space(8)
        .row(
          [
            { text: 'Date' },
            { text: 'Ref', x: 112 },
            { text: 'Details', x: 150 },
            { text: 'Amount', x: 470, align: 'right' },
            { text: 'Balance', x: 545, align: 'right' },
          ],
          { bold: true },
        )
        .rule();
      if (!rows.length) pdf.text('No movements in this period.', { gray: 0.4 });
      for (const r of rows) {
        const details = `${r.type}: ${r.description}`;
        pdf.row([
          { text: r.date },
          { text: r.ref, x: 112 },
          { text: details.length > 52 ? `${details.slice(0, 51)}…` : details, x: 150 },
          { text: formatAmount(r.amount, currency).replace(`${currency} `, ''), x: 470, align: 'right' },
          { text: formatAmount(r.balance, currency).replace(`${currency} `, ''), x: 545, align: 'right' },
        ]);
      }
      return pdf.build();
    },

    async TRANSACTION_REPORT(userId, { currency, from, to, format }) {
      const { lines } = await walletLines(userId, currency, ['CUSTOMER_AVAILABLE', 'CUSTOMER_RESERVED'], from, to);
      const rows = lines.map((l) => [
        l.entry.postedAt.toISOString(),
        l.entry.entryNumber.toString(),
        l.account.purpose === 'CUSTOMER_AVAILABLE' ? 'Available' : 'Reserved',
        ENTRY_LABELS[l.entry.type] ?? l.entry.type,
        l.entry.description,
        toDecimalString(money(-l.amountMinor, currency)),
      ]);
      if (format === 'CSV')
        return toCsv([['Posted at (UTC)', 'Reference', 'Balance', 'Type', 'Description', `Amount (${currency})`], ...rows]);
      const who = await person(userId);
      const period = `${isoDay(from)} to ${isoDay(new Date(to - DAY_MS))}`;
      const pdf = createPdf({ title: `Transaction report ${period}`, footer: `Transaction report ${period}` });
      header(pdf, 'Transaction report', who, [['Period', period]]);
      pdf
        .row(
          [{ text: 'Posted (UTC)' }, { text: 'Balance', x: 150 }, { text: 'Details', x: 210 }, { text: 'Amount', x: 545, align: 'right' }],
          { bold: true },
        )
        .rule();
      if (!rows.length) pdf.text('No movements in this period.', { gray: 0.4 });
      for (const [at, , bal, type, desc, amt] of rows) {
        const details = `${type}: ${desc}`;
        pdf.row([
          { text: at.slice(0, 16).replace('T', ' ') },
          { text: bal, x: 150 },
          { text: details.length > 58 ? `${details.slice(0, 57)}…` : details, x: 210 },
          { text: amt, x: 545, align: 'right' },
        ]);
      }
      return pdf.build();
    },

    async PORTFOLIO_STATEMENT(userId, { currency, asOf, format }) {
      const endOfDay = new Date(asOf.getTime() + DAY_MS - 1);
      const holdings = await portfolio.holdingsWithTerms(userId, currency);
      const { openingMinor: walletMinor } = await walletLines(
        userId,
        currency,
        ['CUSTOMER_AVAILABLE', 'CUSTOMER_RESERVED'],
        new Date(asOf.getTime() + DAY_MS),
        new Date(asOf.getTime() + DAY_MS),
      );
      const rows = holdings
        .map((h) => ({ h, v: portfolio.valueHolding(h, h.terms, endOfDay) }))
        .filter(({ v }) => v)
        .map(({ h, v }) => ({
          product: h.product.name,
          order: h.order.orderNumber.toString(),
          start: isoDay(h.startDate),
          maturity: h.maturityDate ? isoDay(h.maturityDate) : 'Open-ended',
          status: v.method === 'SETTLED' ? 'Matured' : 'Active',
          method: { ACCRUED: 'Estimated (accrued)', COST: 'At cost', SETTLED: 'Realized' }[v.method],
          principal: v.principal,
          value: v.value,
          unrealized: v.unrealized,
          realized: v.realized,
        }));
      const active = rows.filter((r) => r.status === 'Active');
      const holdingsValue = active.reduce((a, r) => a + r.value, 0n);
      const totals = {
        invested: active.reduce((a, r) => a + r.principal, 0n),
        holdingsValue,
        unrealized: active.reduce((a, r) => a + r.unrealized, 0n),
        realized: rows.reduce((a, r) => a + r.realized, 0n),
        wallet: walletMinor,
        total: walletMinor + holdingsValue,
      };
      const d = (m) => toDecimalString(money(m, currency));
      if (format === 'CSV') {
        return toCsv([
          ['As of (end of day, UTC)', isoDay(asOf)],
          [],
          [
            'Product',
            'Order',
            'Start',
            'Maturity',
            'Status',
            'Valuation',
            `Principal (${currency})`,
            `Value (${currency})`,
            `Unrealized (${currency})`,
            `Realized (${currency})`,
          ],
          ...rows.map((r) => [
            r.product,
            r.order,
            r.start,
            r.maturity,
            r.status,
            r.method,
            d(r.principal),
            d(r.value),
            d(r.unrealized),
            d(r.realized),
          ]),
          [],
          ['Wallet (available + reserved)', d(totals.wallet)],
          ['Holdings value', d(totals.holdingsValue)],
          ['Total portfolio value', d(totals.total)],
        ]);
      }
      const who = await person(userId);
      const pdf = createPdf({ title: `Portfolio statement ${isoDay(asOf)}`, footer: `Portfolio statement as of ${isoDay(asOf)}` });
      header(pdf, 'Portfolio statement', who, [['As of', `${isoDay(asOf)} (end of day, UTC)`]]);
      pdf.pairs([
        ['Wallet balance', formatAmount(totals.wallet, currency)],
        ['Invested capital (active)', formatAmount(totals.invested, currency)],
        ['Holdings value', formatAmount(totals.holdingsValue, currency)],
        ['Unrealized return (estimated)', formatAmount(totals.unrealized, currency)],
        ['Realized return (to date)', formatAmount(totals.realized, currency)],
        ['Total portfolio value', formatAmount(totals.total, currency)],
      ]);
      pdf
        .space(8)
        .row(
          [
            { text: 'Investment' },
            { text: 'Matures', x: 260 },
            { text: 'Valuation', x: 322 },
            { text: 'Principal', x: 470, align: 'right' },
            { text: 'Value', x: 545, align: 'right' },
          ],
          { bold: true },
        )
        .rule();
      if (!rows.length) pdf.text('No holdings on this date.', { gray: 0.4 });
      for (const r of rows) {
        pdf.row([
          { text: r.product.length > 40 ? `${r.product.slice(0, 39)}…` : r.product },
          { text: r.maturity, x: 260 },
          { text: r.method, x: 322 },
          { text: d(r.principal), x: 470, align: 'right' },
          { text: r.status === 'Matured' ? `realized ${d(r.realized)}` : d(r.value), x: 545, align: 'right' },
        ]);
      }
      pdf
        .space(10)
        .text(
          'Valuation methods. Estimated (accrued): principal plus interest accrued at the contractual rate, less management fee accrued; not guaranteed until settled. At cost: no reliable price is available, so the amount invested is shown. Realized: proceeds actually received at maturity, after fees.',
          { size: 8, gray: 0.35 },
        );
      return pdf.build();
    },

    async INVESTMENT_CONFIRMATION(userId, { referenceId }) {
      const o = await prisma.investmentOrder.findFirst({
        where: { id: referenceId, userId },
        include: { product: { select: { name: true, issuerName: true } }, allocation: true, holding: true },
      });
      if (!o) throw new NotFoundError('Order not found');
      if (!o.confirmedAt || !o.holding) throw new ConflictError('A confirmation is available once the order is confirmed', 'NOT_CONFIRMED');
      const who = await person(userId);
      const pdf = createPdf({ title: `Investment confirmation #${o.orderNumber}`, footer: `Order #${o.orderNumber}` });
      header(pdf, 'Investment confirmation', who, [['Order', `#${o.orderNumber}`]]);
      pdf.pairs([
        ['Investment', o.product.name],
        ['Issuer', o.product.issuerName],
        ['Product terms version', `v${o.productVersion}`],
        ['Amount', formatAmount(o.amountMinor, o.currency)],
        ['Entry fee', formatAmount(o.feeMinor, o.currency)],
        ['Amount invested', formatAmount(o.amountMinor - o.feeMinor, o.currency)],
        ['Start date', isoDay(o.holding.startDate)],
        ['Maturity date', o.holding.maturityDate ? isoDay(o.holding.maturityDate) : 'Open-ended'],
        ['Allocation reference', o.allocation?.custodianReference],
        ['Confirmed at (UTC)', o.confirmedAt.toISOString().slice(0, 16).replace('T', ' ')],
      ]);
      pdf.space(10).text('Returns are not guaranteed unless the product terms say so. Read the product documents for risks and fees.', {
        size: 8,
        gray: 0.35,
      });
      return pdf.build();
    },

    async DEPOSIT_RECEIPT(userId, { referenceId }) {
      const dep = await prisma.deposit.findFirst({ where: { id: referenceId, userId }, include: { payment: true } });
      if (!dep) throw new NotFoundError('Deposit not found');
      if (dep.status !== 'SUCCEEDED') throw new ConflictError('A receipt is available once the deposit is received', 'NOT_SETTLED');
      const who = await person(userId);
      const pdf = createPdf({ title: `Deposit receipt ${dep.payment?.reference}`, footer: 'Deposit receipt' });
      header(pdf, 'Deposit receipt', who, [['Reference', dep.payment?.reference]]);
      pdf.pairs([
        ['Amount received', formatAmount(dep.amountMinor, dep.currency)],
        ['Provider', dep.payment?.provider],
        ['Received at (UTC)', dep.completedAt?.toISOString().slice(0, 16).replace('T', ' ')],
        ['Credited to', `${dep.currency} wallet (available)`],
      ]);
      return pdf.build();
    },

    async WITHDRAWAL_RECEIPT(userId, { referenceId }) {
      const w = await prisma.withdrawal.findFirst({ where: { id: referenceId, userId } });
      if (!w) throw new NotFoundError('Withdrawal not found');
      if (w.status !== 'COMPLETED') throw new ConflictError('A receipt is available once the withdrawal is paid out', 'NOT_SETTLED');
      const who = await person(userId);
      const pdf = createPdf({ title: 'Withdrawal receipt', footer: 'Withdrawal receipt' });
      header(pdf, 'Withdrawal receipt', who, [['Withdrawal', w.id.slice(0, 8).toUpperCase()]]);
      pdf.pairs([
        ['Amount', formatAmount(w.amountMinor, w.currency)],
        ['Fee', formatAmount(w.feeMinor, w.currency)],
        ['Paid out', formatAmount(w.amountMinor - w.feeMinor, w.currency)],
        ['Destination', w.destinationMasked],
        ['Paid at (UTC)', w.completedAt?.toISOString().slice(0, 16).replace('T', ' ')],
      ]);
      return pdf.build();
    },

    async TAX_STATEMENT(userId, { year, format }) {
      const t = await tax.yearSummary(userId, year);
      const label = { INTEREST: 'Interest', CAPITAL_GAIN: 'Capital gain', REFERRAL_REWARD: 'Referral reward' };
      const d = (minor, currency) => toDecimalString(money(BigInt(minor), currency));
      if (format === 'CSV') {
        return toCsv([
          ['Tax year', String(year)],
          ['Jurisdiction', t.jurisdiction],
          ['Note', 'Estimates only, from configured rules. Not tax advice. Nothing was withheld.'],
          [],
          ['Date', 'Income type', 'Source', 'Currency', 'Income', 'Rule rate (%)', 'Estimated tax'],
          ...t.items.map((i) => [
            i.date,
            label[i.incomeType],
            i.label,
            i.currency,
            d(i.incomeMinor, i.currency),
            i.rule?.ratePercent ?? 'No rule',
            i.estimatedTaxMinor ? d(i.estimatedTaxMinor, i.currency) : '',
          ]),
          [],
          ...Object.entries(t.totals).map(([c, v]) => ['Total', '', '', c, d(v.incomeMinor, c), '', d(v.estimatedTaxMinor, c)]),
        ]);
      }
      const who = await person(userId);
      const pdf = createPdf({ title: `Tax statement ${year}`, footer: `Tax statement ${year}` });
      header(pdf, `Tax statement ${year}`, who, [
        ['Tax year', `1 January to 31 December ${year}`],
        ['Jurisdiction', t.jurisdiction],
      ]);
      pdf.text(
        t.rulesConfigured
          ? 'Estimated tax is calculated from the tax rules configured on the platform. It is not tax advice, and nothing was withheld from your payments. Confirm your obligations with a tax adviser.'
          : 'No tax rules are configured for your jurisdiction, so this statement lists income only. It is not tax advice. Confirm your obligations with a tax adviser.',
        { size: 9, gray: 0.3 },
      );
      pdf
        .space(8)
        .row(
          [
            { text: 'Date' },
            { text: 'Type', x: 112 },
            { text: 'Source', x: 200 },
            { text: 'Income', x: 440, align: 'right' },
            { text: 'Est. tax', x: 545, align: 'right' },
          ],
          { bold: true },
        )
        .rule();
      if (!t.items.length) pdf.text('No realised income in this tax year.', { gray: 0.4 });
      for (const i of t.items) {
        pdf.row([
          { text: i.date },
          { text: label[i.incomeType], x: 112 },
          { text: i.label.length > 38 ? `${i.label.slice(0, 37)}…` : i.label, x: 200 },
          { text: formatAmount(BigInt(i.incomeMinor), i.currency), x: 440, align: 'right' },
          { text: i.estimatedTaxMinor ? formatAmount(BigInt(i.estimatedTaxMinor), i.currency) : 'No rule', x: 545, align: 'right' },
        ]);
      }
      pdf.rule();
      for (const [c, v] of Object.entries(t.totals)) {
        pdf.row([
          { text: `Total (${c})`, bold: true },
          { text: formatAmount(BigInt(v.incomeMinor), c), x: 440, align: 'right', bold: true },
          { text: formatAmount(BigInt(v.estimatedTaxMinor), c), x: 545, align: 'right', bold: true },
        ]);
      }
      const used = [...new Map(t.items.filter((i) => i.rule).map((i) => [i.rule.id, i.rule])).values()];
      if (used.length) {
        pdf.space(10).text('Rules applied', { bold: true, size: 9 });
        for (const r of used)
          pdf.text(`${label[r.incomeType]}: ${r.ratePercent}% from ${r.effectiveFrom}. ${r.description} (${r.legalReference})`, {
            size: 8,
            gray: 0.35,
          });
      }
      return pdf.build();
    },
  };

  const PERIOD_KINDS = ['ACCOUNT_STATEMENT', 'TRANSACTION_REPORT'];
  const RECORD_KINDS = ['INVESTMENT_CONFIRMATION', 'DEPOSIT_RECEIPT', 'WITHDRAWAL_RECEIPT'];

  const serialize = (d) => ({
    id: d.id,
    kind: d.kind,
    title: d.title,
    format: d.format,
    scope: d.scope,
    version: d.version,
    sizeBytes: d.sizeBytes,
    createdAt: d.createdAt,
  });

  async function log(documentId, actorId, action, ip) {
    await prisma.generatedDocumentAccess.create({ data: { documentId, actorId, action, ipAddress: ip ?? null } });
  }

  return {
    ENTRY_LABELS,

    /** Generates, stores and records a document. Params are validated by the route. */
    async generate(auth, { kind, format = 'PDF', currency = 'GHS', from, to, asOf, referenceId, year }, ctx) {
      const userId = auth.user.id;
      if (RECORD_KINDS.includes(kind) && format !== 'PDF')
        throw new ValidationError([{ location: 'body', path: 'format', message: 'Only PDF is available for this document' }]);
      let params;
      let scope;
      let title;
      if (PERIOD_KINDS.includes(kind)) {
        if (!from || !to || to < from) throw new ValidationError([{ location: 'body', path: 'to', message: 'Choose a valid period' }]);
        if ((to - from) / DAY_MS > 366)
          throw new ValidationError([{ location: 'body', path: 'to', message: 'Choose a period of one year or less' }]);
        const end = new Date(to.getTime() + DAY_MS); // the end date is inclusive
        params = { currency, from, to: end, format };
        scope = `${currency}:${isoDay(from)}..${isoDay(to)}`;
        title = `${KIND_TITLES[kind]} ${isoDay(from)} to ${isoDay(to)}`;
      } else if (kind === 'TAX_STATEMENT') {
        const thisYear = new Date().getUTCFullYear();
        if (!year || year < 2020 || year > thisYear)
          throw new ValidationError([{ location: 'body', path: 'year', message: `Choose a year from 2020 to ${thisYear}` }]);
        params = { year, format };
        scope = `tax:${year}`;
        title = `${KIND_TITLES[kind]} ${year}${year === thisYear ? ' (year to date)' : ''}`;
      } else if (kind === 'PORTFOLIO_STATEMENT') {
        const day = asOf ?? new Date(new Date().toISOString().slice(0, 10));
        if (day > new Date()) throw new ValidationError([{ location: 'body', path: 'asOf', message: 'Choose today or an earlier date' }]);
        params = { currency, asOf: day, format };
        scope = `${currency}:asof:${isoDay(day)}`;
        title = `${KIND_TITLES[kind]} as of ${isoDay(day)}`;
      } else {
        if (!referenceId) throw new ValidationError([{ location: 'body', path: 'referenceId', message: 'Required' }]);
        params = { referenceId };
        scope = `ref:${referenceId}`;
        title = KIND_TITLES[kind];
      }

      const content = await builders[kind](userId, params);
      const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
      const storageKey = `generated/${userId}/${randomUUID()}.${format.toLowerCase()}`;
      await storage.put(storageKey, buffer);

      for (let attempt = 0; ; attempt++) {
        try {
          const doc = await prisma.$transaction(async (tx) => {
            const last = await tx.generatedDocument.findFirst({
              where: { userId, kind, format, scope },
              orderBy: { version: 'desc' },
              select: { version: true },
            });
            const version = (last?.version ?? 0) + 1;
            const created = await tx.generatedDocument.create({
              data: {
                userId,
                kind,
                format,
                scope,
                version,
                title: version > 1 ? `${title} (v${version})` : title,
                storageKey,
                sha256: sha256(buffer),
                sizeBytes: buffer.length,
              },
            });
            await tx.generatedDocumentAccess.create({
              data: { documentId: created.id, actorId: userId, action: 'GENERATED', ipAddress: ctx.ip ?? null },
            });
            await audit.record(
              {
                actorId: userId,
                action: 'document.generated',
                entityType: 'generated_document',
                entityId: created.id,
                after: { kind, format, scope, version },
                ...ctx,
              },
              tx,
            );
            return created;
          });
          return serialize(doc);
        } catch (err) {
          if (err.code === 'P2002' && attempt < 2) continue; // two generations raced for the same version number
          await storage.delete(storageKey).catch(() => {});
          throw err;
        }
      }
    },

    async list(userId, { page = 1, pageSize = 20 } = {}) {
      const [total, rows] = await prisma.$transaction([
        prisma.generatedDocument.count({ where: { userId } }),
        prisma.generatedDocument.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      return { data: rows.map(serialize), meta: { page, pageSize, total } };
    },

    async issueDownloadUrl(auth, id, ctx) {
      const doc = await prisma.generatedDocument.findUnique({ where: { id } });
      if (!doc || doc.userId !== auth.user.id) throw new NotFoundError('Document not found');
      const { token, expiresAt } = signer.issue({ documentId: doc.id, actorId: auth.user.id });
      await log(doc.id, auth.user.id, 'URL_ISSUED', ctx.ip);
      return { url: `/api/v1/statements/download?token=${encodeURIComponent(token)}`, expiresAt };
    },

    async download(auth, token, ctx) {
      const claims = signer.verify(token);
      if (!claims) throw new AppError('This download link is invalid or has expired', { status: 403, code: 'DOWNLOAD_LINK_INVALID' });
      if (claims.actorId !== auth.user.id) throw new ForbiddenError('This download link belongs to another user');
      const doc = await prisma.generatedDocument.findUnique({ where: { id: claims.documentId } });
      if (!doc || doc.userId !== auth.user.id) throw new NotFoundError('Document not found');
      const buffer = await storage.get(doc.storageKey);
      if (sha256(buffer) !== doc.sha256) throw new AppError('Document integrity check failed', { status: 500, code: 'DOCUMENT_INTEGRITY' });
      await log(doc.id, auth.user.id, 'DOWNLOADED', ctx.ip);
      const filename = `${doc.title.replace(/[^\w.-]+/g, '-').replace(/-+/g, '-')}.${doc.format.toLowerCase()}`;
      return { buffer, mimeType: doc.format === 'PDF' ? 'application/pdf' : 'text/csv; charset=utf-8', filename };
    },
  };
}
