import type { PlannerTask, RequiredTool } from '../planner';

interface ToolPolicyArgs {
  userRequest: string;
  task: PlannerTask;
  requiredTool: RequiredTool;
  previousObservations: any[];
}

interface ToolPolicyDecision {
  allowed: boolean;
  reason?: string;
}

const EXPLICIT_BROWSER_INTENT_PATTERNS = [
  /\b(open|preview|browse|view)\b/i,
  /\bbrowser\b/i,
  /\bindex\.html\b/i,
  /\bhttps?:\/\//i,
  /打开/,
  /预览/,
  /浏览/,
  /查看网页/,
  /网页版/,
  /运行网页/,
  /运行.*html/i,
];

const DEVELOPMENT_INTENT_PATTERNS = [
  /\b(build|create|develop|implement|fix|edit|write|complete|improve|完善|开发|创建|实现|修复|修改|写|制作|补全)\b/i,
  /游戏.*(完善|开发|创建|实现|修复|修改|制作|补全)/,
  /(完善|开发|创建|实现|修复|修改|制作|补全).*游戏/,
];

function matchesAny(text: string, patterns: RegExp[]) {
  return patterns.some(pattern => pattern.test(text));
}

function hasNonBrowserWork(observation: any): boolean {
  const steps = Array.isArray(observation?.steps) ? observation.steps : [];
  if (steps.some((step: any) => (
    Array.isArray(step?.actions)
      && step.actions.some((action: any) => action?.toolName && action.toolName !== 'openBrowser')
  ))) {
    return true;
  }

  const taskTool = observation?.plannerDecision?.task?.requiredTool;
  return typeof taskTool === 'string' && taskTool !== 'openBrowser';
}

export function evaluatePlannerToolPolicy({
  userRequest,
  task,
  requiredTool,
  previousObservations,
}: ToolPolicyArgs): ToolPolicyDecision {
  if (requiredTool !== 'openBrowser') {
    return { allowed: true };
  }

  const combinedIntentText = `${userRequest}\n${task.description || ''}\n${task.successCriteria || ''}`;
  const hasExplicitBrowserIntent = matchesAny(combinedIntentText, EXPLICIT_BROWSER_INTENT_PATTERNS);
  if (!hasExplicitBrowserIntent) {
    return {
      allowed: false,
      reason: 'Tool policy blocked openBrowser because the user did not explicitly ask to open, preview, browse, view a web page, or run an HTML/web target. Continue the development task with file reads, edits, builds, or checks instead.',
    };
  }

  const isDevelopmentRequest = matchesAny(userRequest, DEVELOPMENT_INTENT_PATTERNS);
  const hasPriorImplementationWork = previousObservations.some(hasNonBrowserWork);
  if (isDevelopmentRequest && !hasPriorImplementationWork) {
    return {
      allowed: false,
      reason: 'Tool policy blocked openBrowser because this is a development request with preview intent. Implement or validate the game first, then open the browser only as a final verification step.',
    };
  }

  return { allowed: true };
}
