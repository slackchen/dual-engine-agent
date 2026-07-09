import { compactTextForModel } from '../../src/shared/modelContext';

function compactArgs(args: any) {
  if (!args || typeof args !== 'object') return args;
  const compact: Record<string, any> = {};
  for (const [key, value] of Object.entries(args)) {
    compact[key] = typeof value === 'string'
      ? compactTextForModel(value, 500)
      : value;
  }
  return compact;
}

function compactPlannerTask(task: any) {
  if (!task || typeof task !== 'object') return task;
  return {
    id: task.id,
    description: compactTextForModel(task.description || '', 600),
    requiredTool: task.requiredTool,
    successCriteria: compactTextForModel(task.successCriteria || '', 400),
    failurePolicy: compactTextForModel(task.failurePolicy || '', 300),
    canRunInParallel: task.canRunInParallel,
    writesFiles: task.writesFiles,
    dependencies: task.dependencies,
  };
}

function compactPlannerDecision(decision: any) {
  if (!decision || typeof decision !== 'object') return decision;
  return {
    type: decision.type,
    summary: compactTextForModel(decision.summary || '', 700),
    task: compactPlannerTask(decision.task),
    tasks: Array.isArray(decision.tasks) ? decision.tasks.map(compactPlannerTask) : undefined,
    workerCount: decision.workerCount,
    completionCriteria: decision.completionCriteria,
  };
}

export function compactStepForObservation(step: any) {
  return {
    workerTaskId: step?.workerTaskId,
    workerTaskDescription: compactTextForModel(step?.workerTaskDescription || '', 500),
    workerInstance: step?.workerInstance,
    thought: compactTextForModel(step?.thought || '', 300),
    actions: (step?.actions || []).map((action: any) => ({
      toolName: action.toolName,
      args: compactArgs(action.args),
    })),
    results: (step?.results || []).map((result: any) => ({
      toolName: result.toolName,
      success: result.success,
      commandSuccess: result.commandSuccess,
      exitCode: result.exitCode,
      pid: result.pid,
      message: compactTextForModel(result.message || result.error || '', 700),
      url: result.url,
      filePath: result.filePath,
      displayPath: result.displayPath,
      startLine: result.startLine,
      endLine: result.endLine,
      linesAdded: result.linesAdded,
      linesRemoved: result.linesRemoved,
    })),
  };
}

export function compactObservationForPlanner(observation: any, index: number) {
  return {
    index,
    workerInstance: observation?.workerInstance,
    policyBlocked: observation?.policyBlocked,
    blockedTool: observation?.blockedTool,
    error: compactTextForModel(observation?.error || '', 900),
    plannerDecision: compactPlannerDecision(observation?.plannerDecision),
    completionCriteria: observation?.completionCriteria,
    workerResult: compactTextForModel(observation?.workerResult || '', 1400),
    steps: Array.isArray(observation?.steps)
      ? observation.steps.slice(-8).map(compactStepForObservation)
      : [],
  };
}

export function compactObservationsForPlanner(observations: any[], maxChars = 14000) {
  const compacted = (Array.isArray(observations) ? observations : [])
    .map((observation, index) => compactObservationForPlanner(observation, index));

  let visible = compacted;
  while (visible.length > 1 && JSON.stringify(visible).length > maxChars) {
    visible = visible.slice(1);
  }

  if (visible.length === compacted.length) return visible;

  return [
    {
      omittedObservationIndexes: compacted
        .slice(0, compacted.length - visible.length)
        .map(observation => observation.index),
      reason: 'Older observations were compacted out to keep Planner context within budget.',
    },
    ...visible,
  ];
}

export function compactObservationsForWorker(observations: any[], maxChars = 4000) {
  const compacted = compactObservationsForPlanner(observations, maxChars);
  return compactTextForModel(compacted, maxChars);
}
