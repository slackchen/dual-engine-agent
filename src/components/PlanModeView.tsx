import { useMemo, useState } from 'react';
import type { PlanDraft, PlanQuestion, PlanSessionState } from '../types';

interface PlanModeViewProps {
  session?: PlanSessionState;
  isPending: boolean;
  executionStarted?: boolean;
  onAnswer: (answer: string) => void;
  onExecute: () => boolean | Promise<boolean>;
}

const formatPlanAnswer = (questions: PlanQuestion[], answers: Record<string, string>) => (
  questions
    .map(question => `Question: ${question.question}\nAnswer: ${answers[question.id] || ''}`)
    .join('\n\n')
);

const PlanDraftView = ({ plan, title }: { plan: PlanDraft; title: string }) => (
  (() => {
    const steps = Array.isArray(plan.steps) ? plan.steps : [];
    const assumptions = Array.isArray(plan.assumptions) ? plan.assumptions : [];
    const risks = Array.isArray(plan.risks) ? plan.risks : [];

    return (
      <div className="plan-mode-draft">
        <div className="plan-mode-section-title">{title}</div>
        <div className="plan-mode-title">{plan.title || 'Plan'}</div>
        {plan.summary && <div className="plan-mode-summary">{plan.summary}</div>}
        {steps.length > 0 && (
          <div className="plan-mode-steps">
            {steps.map((step, index) => (
              <div key={step.id || index} className="plan-mode-step">
                <div className="plan-mode-step-title">
                  {steps.length > 1 && <span>{index + 1}. </span>}
                  {step.title || `Step ${index + 1}`}
                </div>
                {step.description && <div className="plan-mode-step-desc">{step.description}</div>}
                {step.expectedOutcome && <div className="plan-mode-step-outcome">Expected: {step.expectedOutcome}</div>}
              </div>
            ))}
          </div>
        )}
        {(assumptions.length > 0 || risks.length > 0) && (
          <div className="plan-mode-meta">
            {assumptions.length > 0 && <div>Assumptions: {assumptions.join('; ')}</div>}
            {risks.length > 0 && <div>Risks: {risks.join('; ')}</div>}
          </div>
        )}
      </div>
    );
  })()
);

export function PlanModeView({
  session,
  isPending,
  executionStarted,
  onAnswer,
  onExecute,
}: PlanModeViewProps) {
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({});
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
  const [isExecuteSubmitting, setIsExecuteSubmitting] = useState(false);

  const questions = session?.questions || [];
  const resolvedAnswers = useMemo(() => {
    const next: Record<string, string> = {};
    for (const question of questions) {
      const custom = customAnswers[question.id]?.trim();
      next[question.id] = custom || selectedAnswers[question.id] || '';
    }
    return next;
  }, [customAnswers, questions, selectedAnswers]);

  if (!session) return null;

  const canSubmitAnswers = questions.length > 0 && questions.every(question => !!resolvedAnswers[question.id]?.trim());
  const displayPlan = session.status === 'final'
    ? session.finalPlan || session.draftPlan
    : session.draftPlan;

  return (
    <div className="plan-mode-card">
      {session.assistantMessage && <div className="plan-mode-message">{session.assistantMessage}</div>}
      {displayPlan && (
        <PlanDraftView
          plan={displayPlan}
          title={session.status === 'final' ? 'Approved Plan' : 'Draft Plan'}
        />
      )}
      {session.status === 'needs_input' && questions.length > 0 && (
        <div className="plan-mode-questions">
          {questions.map(question => (
            <div key={question.id} className="plan-mode-question">
              <div className="plan-mode-question-text">{question.question}</div>
              <div className="plan-mode-options">
                {question.options.map(option => {
                  const optionText = option.description ? `${option.label}: ${option.description}` : option.label;
                  const isSelected = selectedAnswers[question.id] === optionText && !customAnswers[question.id]?.trim();
                  return (
                    <button
                      key={option.id}
                      type="button"
                      className={`plan-mode-option ${isSelected ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedAnswers(prev => ({ ...prev, [question.id]: optionText }));
                        setCustomAnswers(prev => ({ ...prev, [question.id]: '' }));
                      }}
                    >
                      <span>{option.label}</span>
                      {option.description && <small>{option.description}</small>}
                    </button>
                  );
                })}
              </div>
              {question.allowCustom && (
                <textarea
                  className="plan-mode-custom"
                  placeholder="Custom answer..."
                  value={customAnswers[question.id] || ''}
                  onChange={event => {
                    const value = event.target.value;
                    setCustomAnswers(prev => ({ ...prev, [question.id]: value }));
                  }}
                />
              )}
            </div>
          ))}
          <button
            type="button"
            className="plan-mode-primary"
            disabled={!canSubmitAnswers || isPending}
            onClick={() => {
              if (!canSubmitAnswers) return;
              onAnswer(formatPlanAnswer(questions, resolvedAnswers));
            }}
          >
            Send Answer
          </button>
        </div>
      )}
      {session.status === 'final' && (
        <div className="plan-mode-actions">
          <button
            type="button"
            className="plan-mode-primary"
            disabled={isPending || executionStarted || isExecuteSubmitting}
            onClick={() => {
              if (isPending || executionStarted || isExecuteSubmitting) return;
              setIsExecuteSubmitting(true);
              Promise.resolve(onExecute()).then(started => {
                if (!started) setIsExecuteSubmitting(false);
              }).catch(() => {
                setIsExecuteSubmitting(false);
              });
            }}
          >
            {executionStarted || isExecuteSubmitting ? 'Execution Started' : 'Execute Plan'}
          </button>
        </div>
      )}
    </div>
  );
}
