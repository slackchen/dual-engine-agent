import type { Message, PlanDraft, PlanSessionState } from './types';
import { MODEL_CONTEXT_BUDGETS, compactModelMessages } from './shared/modelContext';

function formatPlanDraft(plan: PlanDraft | null | undefined) {
  if (!plan) return '';

  const steps = Array.isArray(plan.steps)
    ? plan.steps.map((step, index) => {
        const title = step.title || `Step ${index + 1}`;
        const description = step.description ? `: ${step.description}` : '';
        const expected = step.expectedOutcome ? ` Expected: ${step.expectedOutcome}` : '';
        return `${index + 1}. ${title}${description}${expected}`;
      }).join('\n')
    : '';

  return [
    `Plan: ${plan.title || 'Plan'}`,
    plan.summary,
    steps ? `Steps:\n${steps}` : '',
    plan.assumptions?.length ? `Assumptions:\n${plan.assumptions.join('\n')}` : '',
    plan.risks?.length ? `Risks:\n${plan.risks.join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

export function formatPlanSessionForHistory(session: PlanSessionState | null | undefined) {
  if (!session) return '';

  return [
    session.assistantMessage,
    formatPlanDraft(session.finalPlan || session.draftPlan),
    session.questions?.length
      ? `Questions:\n${session.questions.map(question => question.question).join('\n')}`
      : '',
  ].filter(Boolean).join('\n\n');
}

export function buildChatHistory(messages: Message[]) {
  const rawHistory = messages
    .filter(message => message.id !== 'init')
    .map(message => {
      let textContent = message.content || '';

      if (message.role === 'ai' && message.finalSummary) {
        textContent = `Final Summary:\n${message.finalSummary}`;
      } else if (message.role === 'ai' && message.planSession) {
        textContent = formatPlanSessionForHistory(message.planSession);
      }

      if (message.role === 'ai' && !textContent && message.agentSteps?.length > 0) {
        const toolsUsed = message.agentSteps
          .flatMap(step => (step.actions || []).map((action: any) => action.toolName))
          .filter(Boolean);
        if (toolsUsed.length > 0) textContent = `[Executed tools: ${toolsUsed.join(', ')}]`;
      }

      return { role: message.role === 'user' ? 'user' : 'assistant', content: textContent };
    })
    .filter(message => !!message.content);

  return compactModelMessages(rawHistory, MODEL_CONTEXT_BUDGETS.frontendChatHistory);
}
