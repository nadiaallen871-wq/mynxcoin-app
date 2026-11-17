import { Link } from 'react-router';
import { BookOpenCheck, Landmark, Scale, ShieldCheck } from 'lucide-react';
import { usePageMeta } from '../../hooks/usePageMeta.js';

const PRINCIPLES = [
  {
    icon: Landmark,
    title: 'Every cedi accounted for',
    body: 'Balances come from a double-entry ledger, not from a number someone can edit. Each movement has a matching entry and an audit trail.',
  },
  {
    icon: ShieldCheck,
    title: 'Security by default',
    body: 'Multi-factor authentication, encrypted sessions, strict permissions and continuous monitoring protect your account.',
  },
  {
    icon: Scale,
    title: 'Clear terms, no surprises',
    body: 'Fees, risks, lock-up periods and redemption rules are shown before you commit, in plain language.',
  },
  {
    icon: BookOpenCheck,
    title: 'Verified investors only',
    body: 'Identity verification and suitability checks help keep the platform safe and appropriate for every investor.',
  },
];

export default function HomePage() {
  usePageMeta({
    title: 'Mynx: Invest with clarity',
    description:
      'A transparent digital investment platform. Investments carry risk, and past performance does not guarantee future results.',
  });

  return (
    <>
      <section className="bg-navy-900 text-white">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 md:py-28">
          <p className="text-sm font-semibold tracking-wider text-brand-500 uppercase">Digital investing, built on integrity</p>
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-balance md:text-5xl">
            Invest with clarity, from onboarding to every statement.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-white/75">
            Mynx is being built to let individuals and eligible organisations discover, fund and track investments, with transparent fees,
            clear risk disclosures and records you can trust.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link
              to="/risk-disclosures"
              className="inline-flex h-12 items-center rounded-lg bg-brand-600 px-6 font-medium text-white transition-colors hover:bg-brand-700"
            >
              Understand the risks
            </Link>
            <Link
              to="/status"
              className="inline-flex h-12 items-center rounded-lg border border-white/25 px-6 font-medium text-white transition-colors hover:bg-white/10"
            >
              Platform status
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 md:py-24" aria-labelledby="principles-heading">
        <h2 id="principles-heading" className="text-2xl font-semibold tracking-tight text-ink md:text-3xl">
          How we are building Mynx
        </h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {PRINCIPLES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-card border border-border bg-surface p-6 shadow-card">
              <div className="inline-flex rounded-lg bg-brand-50 p-2.5 text-brand-700">
                <Icon className="size-5" aria-hidden="true" />
              </div>
              <h3 className="mt-4 font-semibold text-ink">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
