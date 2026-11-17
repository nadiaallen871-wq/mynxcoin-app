import { Link } from 'react-router';
import { Card, CardBody } from '../../components/ui/index.js';
import { ProjectionCalculator } from '../../features/investments/Calculator.jsx';
import { usePageMeta } from '../../hooks/usePageMeta.js';

export default function CalculatorPage() {
  usePageMeta({
    title: 'Investment calculator · Mynx',
    description: 'See how fees and time affect an illustrative investment outcome. Illustrations are not guarantees.',
  });
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 md:py-14">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Investment calculator</h1>
      <p className="mt-2 text-ink-muted">
        Enter an amount, a period and a rate to see how fees and time affect an illustrative outcome. To use a real product’s terms, open it
        from the{' '}
        <Link to="/investments" className="font-medium text-brand-700 underline">
          marketplace
        </Link>
        .
      </p>
      <Card className="mt-8">
        <CardBody>
          <ProjectionCalculator />
        </CardBody>
      </Card>
    </div>
  );
}
