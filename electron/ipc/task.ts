import { ipcMain } from 'electron';
import { PlannerEngine } from '../planner';
import type { PlannerDecision, RequiredTool } from '../planner';
import { WorkerEngine } from '../worker';
import { buildFileTree } from './workspace';
import { openBrowserPreview } from './browser';

const MAX_CONTROLLER_DECISIONS = 20;
const VALID_REQUIRED_TOOLS = new Set<RequiredTool>([
  'readFile',
  'createFile',
  'writeFile',
  'editFileContent',
  'runCommand',
  'openBrowser',
  'launchApp',
]);

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
      filePath: result.filePath,
      displayPath: result.displayPath,
      startLine: result.startLine,
      endLine: result.endLine,
      linesAdded: result.linesAdded,
      linesRemoved: result.linesRemoved,
    })),
  };
}

function normalizeRequiredTool(toolName: any): RequiredTool | undefined {
  return VALID_REQUIRED_TOOLS.has(toolName) ? toolName : undefined;
}

function formatDecisionResult(decision: PlannerDecision) {
  return decision.finalResponse || decision.reason || decision.summary || JSON.stringify(decision);
}

function normalizeInitialPlan(plan: any) {
  return {
    ...plan,
    summary: typeof plan?.summary === 'string' ? plan.summary : 'Planner is deciding how to handle the request.',
    subtasks: Array.isArray(plan?.subtasks) ? plan.subtasks : [],
  };
}

function isValidCompleteDecision(decision: PlannerDecision, observations: any[]) {
  const evidence = decision.completionEvidence;
  if (observations.length === 0) {
    return evidence?.source === 'conversation_only';
  }

  if (evidence?.source === 'tool_observation') {
    const indexes = Array.isArray(evidence.observationIndexes) ? evidence.observationIndexes : [];
    return indexes.some(index => Number.isInteger(index) && index >= 0 && index < observations.length);
  }

  return true;
}

export function registerTaskHandlers() {
  const planner = new PlannerEngine();
  const worker = new WorkerEngine();
  const abortControllers: Record<string, AbortController> = {};

  const getEngineConfig = (specificConfig: any, fallback: any) => ({
    protocol: specificConfig?.protocol ?? fallback.protocol,
    authMethod: specificConfig?.authMethod ?? fallback.authMethod,
    tokenOrKey: specificConfig?.tokenOrKey ?? fallback.tokenOrKey,
    baseUrl: specificConfig?.baseUrl ?? fallback.baseUrl,
  });

  ipcMain.handle('agent:stop-task', (_event, { runId }) => {
    if (abortControllers[runId]) {
      abortControllers[runId].abort();
      delete abortControllers[runId];
    }
  });

  ipcMain.handle('agent:run-task', async (event, arg) => {
    const { protocol, authMethod, tokenOrKey, plannerModel, workerModel, task, workspacePath, baseUrl, chatHistory, maxSteps, runId, plannerConfig, workerConfig } = arg;
    if (!task) return 'Error: Task is required';

    const fallbackConfig = { protocol, authMethod, tokenOrKey, baseUrl };
    const plannerRuntime = getEngineConfig(plannerConfig, fallbackConfig);
    const workerRuntime = getEngineConfig(workerConfig, fallbackConfig);

    const abortController = new AbortController();
    abortControllers[runId] = abortController;
    const signal = abortController.signal;

    try {
      event.sender.send('agent:update', { type: 'status', data: 'Planning subtasks...', runId });
      event.sender.send('agent:update', { type: 'api-call', data: 'planner', runId });

      const rawPlan = await planner.plan(
        plannerRuntime.protocol,
        plannerRuntime.authMethod,
        plannerRuntime.tokenOrKey,
        plannerModel,
        task,
        plannerRuntime.baseUrl,
        chatHistory || [],
        signal
      );
      const plan = normalizeInitialPlan(rawPlan);

      event.sender.send('agent:update', { type: 'plan', data: plan, runId });

      const observations: any[] = [];
      const maxControllerDecisions = Math.min(Math.max(maxSteps || MAX_CONTROLLER_DECISIONS, 1), MAX_CONTROLLER_DECISIONS);

      for (let decisionIndex = 0; decisionIndex < maxControllerDecisions; decisionIndex++) {
        event.sender.send('agent:update', {
          type: 'status',
          data: decisionIndex === 0 ? 'Planner deciding next action...' : 'Planner reviewing tool result...',
          runId,
        });
        event.sender.send('agent:update', { type: 'api-call', data: 'planner', runId });

        const decision = await planner.decideNextAction(
          plannerRuntime.protocol,
          plannerRuntime.authMethod,
          plannerRuntime.tokenOrKey,
          plannerModel,
          task,
          plannerRuntime.baseUrl,
          chatHistory || [],
          {
            workspacePath,
            initialPlan: plan,
            observations,
            decisionIndex,
          },
          signal
        );

        if (decision.type === 'complete' && !isValidCompleteDecision(decision, observations)) {
          observations.push({
            plannerDecision: decision,
            error: 'Planner returned complete without valid completionEvidence. It must either mark a pure conversation as conversation_only, or cite tool_observation indexes that exist.',
          });
          event.sender.send('agent:update', {
            type: 'status',
            data: 'Planner returned completion without valid evidence; asking Planner to correct the decision...',
            runId,
          });
          continue;
        }

        if (decision.type === 'complete') {
          event.sender.send('agent:update', { type: 'subtask-result', data: formatDecisionResult(decision), runId });
          return 'All tasks completed';
        }

        if (decision.type === 'blocked') {
          event.sender.send('agent:update', { type: 'subtask-result', data: formatDecisionResult(decision), runId });
          return 'All tasks completed';
        }

        if (decision.type !== 'execute' || !decision.task) {
          observations.push({
            decision,
            error: 'Planner returned an execute decision without a task. Planner must retry with a valid task.',
          });
          continue;
        }

        const requiredTool = normalizeRequiredTool(decision.task.requiredTool);
        if (!requiredTool) {
          observations.push({
            plannerDecision: decision,
            error: `Planner returned a task without a valid requiredTool. requiredTool must be one of: ${Array.from(VALID_REQUIRED_TOOLS).join(', ')}.`,
          });
          event.sender.send('agent:update', {
            type: 'status',
            data: 'Planner omitted a required tool; asking Planner to correct the next action...',
            runId,
          });
          continue;
        }

        event.sender.send('agent:update', { type: 'status', data: `Executing: ${decision.task.description}`, runId });

        const stepDataForObservation: any[] = [];
        const taskPrompt = [
          `Task: ${decision.task.description}`,
          `Required tool: ${requiredTool}`,
          `Success criteria: ${decision.task.successCriteria}`,
          `Failure policy: ${decision.task.failurePolicy}`,
          `Context from previous Planner decisions and Worker observations:`,
          compactText(observations, 4000),
        ].join('\n\n');

        const result = await worker.executeTask(
          workerRuntime.protocol,
          workerRuntime.authMethod,
          workerRuntime.tokenOrKey,
          workerModel,
          taskPrompt,
          workspacePath,
          (log: string) => {
            console.log(`[Agent Log] ${log.trim()}`);
            event.sender.send('agent:terminal-log', log);
          },
          (stepData: any) => {
            stepDataForObservation.push(stepData);
            event.sender.send('agent:update', { type: 'api-call', data: 'worker', runId });
            event.sender.send('agent:update', { type: 'agent-step', data: stepData, runId });
          },
          () => {
            event.sender.send('agent:update', { type: 'model-wait-start', runId });
          },
          (url: string) => {
            openBrowserPreview(url);
          },
          (filePath: string, payload?: any) => {
            event.sender.send('agent:file-updated', { filePath, ...payload });
            const newTree = buildFileTree(workspacePath);
            event.sender.send('agent:update', { type: 'fs-state', data: newTree, runId });
          },
          workerRuntime.baseUrl,
          chatHistory || [],
          maxSteps || 20,
          requiredTool,
          signal
        );

        observations.push({
          plannerDecision: decision,
          workerResult: compactText(result, 1600),
          steps: stepDataForObservation.map(compactStep),
        });

        event.sender.send('agent:update', { type: 'subtask-result', data: result, runId });

        const newTree = buildFileTree(workspacePath);
        event.sender.send('agent:update', { type: 'fs-state', data: newTree, runId });
      }

      event.sender.send('agent:update', {
        type: 'subtask-result',
        data: `Blocked: reached Planner decision limit (${maxControllerDecisions}) before completion.`,
        runId,
      });
      return 'All tasks completed';
    } catch (err: any) {
      if (err.name === 'AbortError' || (err.message && err.message.includes('AbortError'))) {
        return 'Stopped by user';
      }
      let errMsg = err.message;
      if (errMsg.includes('GenerateRequestsPerDayPerProjectPerModel-FreeTier')) {
        errMsg = 'Google Gemini Free Tier Daily Quota Exceeded (Limit: 20 requests/day). Please switch to OpenAI or a paid API Key.';
      } else if (errMsg.includes('QuotaFailure') || errMsg.includes('429')) {
        errMsg = 'API Rate Limit or Quota Exceeded. Please slow down or check your API key balance.';
      }
      await new Promise(r => setTimeout(r, 150));
      return `Error: ${errMsg}`;
    } finally {
      delete abortControllers[runId];
    }
  });
}
