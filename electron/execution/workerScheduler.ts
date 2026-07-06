import { WorkerEngine } from '../worker';
import type { PlannerDecision, PlannerTask, RequiredTool } from '../planner';
import { normalizeRequiredTool, VALID_REQUIRED_TOOLS } from './decisionUtils';

const MAX_PARALLEL_WORKERS = 3;

interface WorkerRuntimeConfig {
  protocol: string;
  authMethod: string;
  tokenOrKey: string;
  baseUrl: string;
}

interface ExecutePlannerDecisionArgs {
  decision: PlannerDecision;
  workerRuntime: WorkerRuntimeConfig;
  workerModel: string;
  workspacePath: string;
  chatHistory: any[];
  maxSteps: number;
  previousObservations: any[];
  abortSignal?: AbortSignal;
  onStatus: (status: string) => void;
  onLog: (log: string) => void;
  onWorkerApiCall: () => void;
  onStep: (stepData: any) => void;
  onModelWait: () => void;
  onOpenBrowser: (url: string) => void;
  onFileUpdated: (filePath: string, payload?: any) => void;
  onTaskResult: (result: string) => void;
  onRefreshFileTree: () => void;
}

interface RunnablePlannerTask {
  task: PlannerTask;
  requiredTool: RequiredTool;
  workerLabel: string;
}

function compactText(value: any, maxLength = 1200) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function compactArgs(args: any) {
  if (!args || typeof args !== 'object') return args;
  const compact: Record<string, any> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && value.length > 500) {
      compact[key] = `${value.slice(0, 500)}... (${value.length} chars)`;
    } else {
      compact[key] = value;
    }
  }
  return compact;
}

function compactStep(step: any) {
  return {
    workerTaskId: step?.workerTaskId,
    workerTaskDescription: step?.workerTaskDescription,
    workerInstance: step?.workerInstance,
    thought: compactText(step?.thought || '', 400),
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
      message: compactText(result.message || result.error || '', 800),
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

function normalizePlannerTasks(decision: PlannerDecision) {
  if (decision.type === 'execute' && decision.task) return [decision.task];
  if (decision.type === 'execute_batch' && Array.isArray(decision.tasks)) return decision.tasks;
  return [];
}

function getRequestedWorkerCount(decision: PlannerDecision, taskCount: number) {
  const requested = Number.isFinite(decision.workerCount)
    ? Number(decision.workerCount)
    : taskCount;
  return Math.min(Math.max(Math.floor(requested || 1), 1), MAX_PARALLEL_WORKERS, Math.max(taskCount, 1));
}

function canRunInParallel(task: PlannerTask, requiredTool: RequiredTool) {
  if (task.canRunInParallel !== true) return false;
  if (task.writesFiles === true) return false;
  if (Array.isArray(task.dependencies) && task.dependencies.length > 0) return false;
  return requiredTool === 'readFile' || requiredTool === 'runCommand';
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  runner: (item: T, index: number) => Promise<R>,
  shouldStop: () => boolean
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(concurrency, 1), items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (!shouldStop() && nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await runner(items[currentIndex], currentIndex);
    }
  }));

  return results.filter(Boolean);
}

function buildTaskPrompt(task: PlannerTask, requiredTool: RequiredTool, observations: any[]) {
  return [
    `Task: ${task.description}`,
    `Required tool: ${requiredTool}`,
    `Success criteria: ${task.successCriteria}`,
    `Failure policy: ${task.failurePolicy}`,
    `Context from previous Planner decisions and Worker observations:`,
    compactText(observations, 4000),
  ].join('\n\n');
}

function invalidTaskObservation(decision: PlannerDecision, task: PlannerTask | undefined, error: string) {
  return {
    plannerDecision: decision,
    task,
    error,
  };
}

async function executeOneTask(
  runnable: RunnablePlannerTask,
  args: ExecutePlannerDecisionArgs,
  observationsSnapshot: any[]
) {
  if (args.abortSignal?.aborted) {
    return invalidTaskObservation(args.decision, runnable.task, 'Task stopped by user before Worker execution.');
  }

  const stepDataForObservation: any[] = [];
  const taskWorker = new WorkerEngine();
  const result = await taskWorker.executeTask(
    args.workerRuntime.protocol,
    args.workerRuntime.authMethod,
    args.workerRuntime.tokenOrKey,
    args.workerModel,
    buildTaskPrompt(runnable.task, runnable.requiredTool, observationsSnapshot),
    args.workspacePath,
    (log: string) => {
      if (!args.abortSignal?.aborted) args.onLog(log);
    },
    (stepData: any) => {
      if (args.abortSignal?.aborted) return;
      const annotatedStep = {
        ...stepData,
        workerTaskId: runnable.task.id,
        workerTaskDescription: runnable.task.description,
        workerInstance: runnable.workerLabel,
      };
      stepDataForObservation.push(annotatedStep);
      args.onWorkerApiCall();
      args.onStep(annotatedStep);
    },
    () => {
      if (!args.abortSignal?.aborted) args.onModelWait();
    },
    (url: string) => {
      if (!args.abortSignal?.aborted) args.onOpenBrowser(url);
    },
    (filePath: string, payload?: any) => {
      if (!args.abortSignal?.aborted) args.onFileUpdated(filePath, payload);
    },
    args.workerRuntime.baseUrl,
    args.chatHistory || [],
    args.maxSteps || 20,
    runnable.requiredTool,
    args.abortSignal
  );

  if (args.abortSignal?.aborted) {
    return invalidTaskObservation(args.decision, runnable.task, 'Task stopped by user.');
  }

  args.onTaskResult(result);
  args.onRefreshFileTree();

  return {
    plannerDecision: {
      type: args.decision.type,
      summary: args.decision.summary,
      task: runnable.task,
      workerCount: args.decision.workerCount,
      completionCriteria: args.decision.completionCriteria,
    },
    completionCriteria: args.decision.completionCriteria,
    workerResult: compactText(result, 1600),
    workerInstance: runnable.workerLabel,
    steps: stepDataForObservation.map(compactStep),
  };
}

export async function executePlannerDecision(args: ExecutePlannerDecisionArgs) {
  if (args.abortSignal?.aborted) {
    return {
      observations: [
        invalidTaskObservation(args.decision, undefined, 'Task stopped by user before execution.'),
      ],
      executed: false,
    };
  }

  const tasks = normalizePlannerTasks(args.decision);
  if (tasks.length === 0) {
    return {
      observations: [
        invalidTaskObservation(args.decision, undefined, 'Planner returned an execute decision without task data.'),
      ],
      executed: false,
    };
  }

  const invalidObservations: any[] = [];
  const runnableTasks: RunnablePlannerTask[] = [];
  tasks.forEach((task, index) => {
    const requiredTool = normalizeRequiredTool(task.requiredTool);
    if (!requiredTool) {
      invalidObservations.push(invalidTaskObservation(
        args.decision,
        task,
        `Planner task ${task.id || index} is missing a valid requiredTool. requiredTool must be one of: ${Array.from(VALID_REQUIRED_TOOLS).join(', ')}.`
      ));
      return;
    }
    runnableTasks.push({
      task,
      requiredTool,
      workerLabel: args.decision.type === 'execute_batch' ? `Worker ${index + 1}` : 'Worker',
    });
  });

  if (runnableTasks.length === 0) {
    return { observations: invalidObservations, executed: false };
  }

  const requestedWorkerCount = getRequestedWorkerCount(args.decision, runnableTasks.length);
  if (args.decision.type === 'execute_batch') {
    const parallelEligibleCount = runnableTasks.filter(task => canRunInParallel(task.task, task.requiredTool)).length;
    const effectiveWorkerCount = parallelEligibleCount > 1
      ? Math.min(requestedWorkerCount, parallelEligibleCount)
      : 1;
    if (!args.abortSignal?.aborted) {
      args.onStatus(`Executing batch: ${runnableTasks.length} tasks, using up to ${effectiveWorkerCount} worker(s)...`);
    }
  } else {
    if (!args.abortSignal?.aborted) {
      args.onStatus(`Executing: ${runnableTasks[0].task.description}`);
    }
  }

  const observations: any[] = [...invalidObservations];
  const parallelBuffer: RunnablePlannerTask[] = [];

  const flushParallelBuffer = async () => {
    if (args.abortSignal?.aborted || parallelBuffer.length === 0) return;
    const snapshot = [...args.previousObservations, ...observations];
    const batch = parallelBuffer.splice(0, parallelBuffer.length);
    const concurrency = Math.min(requestedWorkerCount, batch.length);
    const batchObservations = await runWithConcurrency(
      batch,
      concurrency,
      runnable => executeOneTask(runnable, args, snapshot),
      () => !!args.abortSignal?.aborted
    );
    observations.push(...batchObservations);
  };

  for (const runnable of runnableTasks) {
    if (args.abortSignal?.aborted) break;
    if (args.decision.type === 'execute_batch' && canRunInParallel(runnable.task, runnable.requiredTool)) {
      parallelBuffer.push(runnable);
      continue;
    }

    await flushParallelBuffer();
    const snapshot = [...args.previousObservations, ...observations];
    observations.push(await executeOneTask(runnable, args, snapshot));
  }

  await flushParallelBuffer();

  return { observations, executed: true };
}
