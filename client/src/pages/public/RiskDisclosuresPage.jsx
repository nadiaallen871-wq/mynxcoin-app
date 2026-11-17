import { Alert } from '../../components/ui/index.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';

const SECTIONS = [
  [
    'Capital at risk',
    'The value of investments and any income from them can fall as well as rise. You may get back less than you invest, and in some cases you may lose all of the capital invested.',
  ],
  [
    'No guaranteed returns',
    'Projected, target or illustrative returns are not promises. Historical performance is not a reliable indicator of future results.',
  ],
  [
    'Liquidity',
    'Some products have lock-up periods or limited redemption windows. You may not be able to access your money when you want to, or only at a cost.',
  ],
  [
    'Counterparty and issuer risk',
    'Products depend on issuers, custodians and other counterparties meeting their obligations. If they fail to do so, you could lose money.',
  ],
  [
    'Currency risk',
    'Where a product is denominated in a currency other than your own, exchange-rate movements can change its value to you.',
  ],
  [
    'Regulatory status',
    'Mynx is not yet authorised to provide regulated investment services. This environment is a sandbox: no real money is accepted, and all balances and investments shown are simulated.',
  ],
  [
    'Not advice',
    'Information on this platform is general and does not consider your personal circumstances. Consider seeking independent financial advice before investing.',
  ],
];

export default function RiskDisclosuresPage() {
  usePageMeta({ title: 'Risk disclosures · Mynx', description: 'Understand the risks of investing before using Mynx.' });
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 md:py-16">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Risk disclosures</h1>
      <p className="mt-3 text-ink-muted">Please read these disclosures carefully. They apply to every product offered through Mynx.</p>
      <Alert tone="warning" title="This draft is pending legal review" className="mt-6">
        Final disclosure wording must be approved by qualified counsel for each market before launch.
      </Alert>
      <div className="mt-10 space-y-8">
        {SECTIONS.map(([title, body]) => (
          <section key={title}>
            <h2 className="text-lg font-semibold text-ink">{title}</h2>
            <p className="mt-2 leading-relaxed text-ink-muted">{body}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
