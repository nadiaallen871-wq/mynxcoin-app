import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, ErrorState, Skeleton } from '../../components/ui/index.js';
import { api } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { ONBOARDING_KEY } from './OnboardingForms.jsx';
import { RISK_PROFILES } from './labels.js';
import { formatDateTime } from '../../utils/format.js';

/** Suitability questionnaire. Questions come from the server, and so does the score. */
export function RiskQuestionnaire({ current, disabled, onSaved }) {
  const qc = useQueryClient();
  const toast = useToast();
  const questionnaire = useQuery({
    queryKey: ['onboarding', 'questionnaire'],
    queryFn: () => api.get('/onboarding/risk-questionnaire').then((r) => r.data),
    staleTime: Infinity,
  });
  const [answers, setAnswers] = useState(current?.answers ?? {});
  const [retaking, setRetaking] = useState(!current);
  const submit = useMutation({
    mutationFn: () => api.post('/onboarding/risk-assessment', { answers }),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ONBOARDING_KEY });
      setRetaking(false);
      toast.success('Questionnaire saved', `Your risk profile: ${RISK_PROFILES[res.data.riskProfile]}`);
      onSaved?.();
    },
  });

  if (current && !retaking) {
    return (
      <div className="space-y-3">
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink">
          Your risk profile: <Badge tone="info">{RISK_PROFILES[current.riskProfile]}</Badge>
          <span className="tabular text-ink-subtle">
            score {current.score}/100 · {formatDateTime(current.completedAt)}
          </span>
        </p>
        <p className="text-sm text-ink-muted">
          We use this to show you suitable products and warn you about higher-risk ones. It is not investment advice.
        </p>
        {!disabled && (
          <Button variant="secondary" size="sm" onClick={() => setRetaking(true)}>
            Retake questionnaire
          </Button>
        )}
      </div>
    );
  }

  if (questionnaire.isPending) return <Skeleton className="h-40" />;
  if (questionnaire.isError) return <ErrorState error={questionnaire.error} onRetry={questionnaire.refetch} />;
  const questions = questionnaire.data.questions;
  const complete = questions.every((q) => answers[q.id]);

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit.mutate();
      }}
    >
      {submit.error && <Alert tone="danger">{submit.error.message}</Alert>}
      {questions.map((q, i) => (
        <fieldset key={q.id} disabled={disabled}>
          <legend className="text-sm font-medium text-ink">
            {i + 1}. {q.text}
          </legend>
          <div className="mt-2 grid gap-2">
            {q.options.map((o) => (
              <label
                key={o.id}
                className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-muted has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50"
              >
                <input
                  type="radio"
                  name={q.id}
                  value={o.id}
                  checked={answers[q.id] === o.id}
                  onChange={() => setAnswers((a) => ({ ...a, [q.id]: o.id }))}
                  className="size-4 accent-brand-600"
                />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <div className="flex justify-end gap-2">
        {current && (
          <Button variant="ghost" onClick={() => setRetaking(false)}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={!complete || disabled} loading={submit.isPending}>
          See my risk profile
        </Button>
      </div>
    </form>
  );
}
