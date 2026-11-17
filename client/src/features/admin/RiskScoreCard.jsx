import { useQuery } from '@tanstack/react-query';
import { Badge, Card, CardBody, CardHeader, Skeleton } from '../../components/ui/index.js';
import { api } from '../../services/api.js';

const BAND = {
  HIGH: { tone: 'danger', label: 'High' },
  MEDIUM: { tone: 'warning', label: 'Medium' },
  LOW: { tone: 'neutral', label: 'Low' },
};

/** Explainable fraud/AML risk score for one person (compliance staff only). */
export function RiskScoreCard({ userId }) {
  const q = useQuery({
    queryKey: ['admin', 'risk-score', userId],
    queryFn: () => api.get(`/admin/insights/risk-scores/${userId}`).then((r) => r.data),
  });
  return (
    <Card>
      <CardHeader
        title="Risk score"
        description="Ranks people for review. It never blocks anything by itself."
        actions={q.data && <Badge tone={BAND[q.data.band].tone}>{`${q.data.score} · ${BAND[q.data.band].label}`}</Badge>}
      />
      <CardBody>
        {q.isPending && <Skeleton className="h-16" />}
        {q.data &&
          (q.data.factors.length ? (
            <ul className="space-y-1 text-sm text-ink-muted">
              {q.data.factors.map((f) => (
                <li key={f.reason} className="flex justify-between gap-3">
                  <span>{f.reason}</span>
                  <span className="tabular font-medium text-ink">+{f.points}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">No risk signals.</p>
          ))}
      </CardBody>
    </Card>
  );
}
