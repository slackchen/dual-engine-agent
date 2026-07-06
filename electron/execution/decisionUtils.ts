import type { PlannerDecision, RequiredTool } from '../planner';

export const VALID_REQUIRED_TOOLS = new Set<RequiredTool>([
  'readFile',
  'createFile',
  'writeFile',
  'editFileContent',
  'runCommand',
  'openBrowser',
  'launchApp',
]);

export function normalizeRequiredTool(toolName: unknown): RequiredTool | undefined {
  return VALID_REQUIRED_TOOLS.has(toolName as RequiredTool) ? toolName as RequiredTool : undefined;
}

export function formatDecisionResult(decision: PlannerDecision) {
  return decision.finalResponse || decision.reason || decision.summary || JSON.stringify(decision);
}

export function normalizeInitialPlan(plan: any) {
  return {
    ...plan,
    summary: typeof plan?.summary === 'string' ? plan.summary : 'Planner is deciding how to handle the request.',
    subtasks: Array.isArray(plan?.subtasks) ? plan.subtasks : [],
  };
}

export function isValidCompleteDecision(decision: PlannerDecision, observations: any[]) {
  const evidence = decision.completionEvidence;
  if (observations.length === 0) {
    return evidence?.source === 'conversation_only';
  }

  if (evidence?.source !== 'tool_observation') return false;

  const indexes = Array.isArray(evidence.observationIndexes) ? evidence.observationIndexes : [];
  return indexes.some(index => Number.isInteger(index) && index >= 0 && index < observations.length);
}
