import { ipcMain } from 'electron';
import { PlannerEngine } from '../planner';
import { buildFileTree } from './workspace';
import { openBrowserPreview } from './browser';
import {
  formatDecisionResult,
  isValidCompleteDecision,
  normalizeInitialPlan,
} from '../execution/decisionUtils';
import { executePlannerDecision } from '../execution/workerScheduler';

const MAX_CONTROLLER_DECISIONS = 20;

export function registerTaskHandlers() {
  const planner = new PlannerEngine();
  const abortControllers: Record<string, AbortController> = {};

  const getEngineConfig = (specificConfig: any, fallback: any) => ({
    protocol: specificConfig?.protocol ?? fallback.protocol,
    authMethod: specificConfig?.authMethod ?? fallback.authMethod,
    tokenOrKey: specificConfig?.tokenOrKey ?? fallback.tokenOrKey,
    baseUrl: specificConfig?.baseUrl ?? fallback.baseUrl,
  });

  const throwIfAborted = (signal: AbortSignal) => {
    if (signal.aborted) {
      throw new DOMException('Stopped by user', 'AbortError');
    }
  };

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
      event.sender.send('agent:update', { type: 'status', data: 'Planning executable batch...', runId });
      event.sender.send('agent:update', { type: 'api-call', data: 'planner', runId });

      const initialPlanResult = await planner.planAndDecide(
        plannerRuntime.protocol,
        plannerRuntime.authMethod,
        plannerRuntime.tokenOrKey,
        plannerModel,
        task,
        plannerRuntime.baseUrl,
        chatHistory || [],
        { workspacePath },
        signal
      );
      throwIfAborted(signal);
      const plan = normalizeInitialPlan({
        summary: initialPlanResult.summary,
        subtasks: initialPlanResult.subtasks,
      });

      event.sender.send('agent:update', { type: 'plan', data: plan, runId });

      const observations: any[] = [];
      const maxControllerDecisions = Math.min(Math.max(maxSteps || MAX_CONTROLLER_DECISIONS, 1), MAX_CONTROLLER_DECISIONS);
      const sendFinalResult = (fallbackText: string) => {
        throwIfAborted(signal);
        event.sender.send('agent:update', { type: 'final-result', data: fallbackText, runId });
      };

      const handleDecision = async (decision: any) => {
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
          return false;
        }

        if (decision.type === 'complete') {
          sendFinalResult(formatDecisionResult(decision));
          return true;
        }

        if (decision.type === 'blocked') {
          sendFinalResult(formatDecisionResult(decision));
          return true;
        }

        if (decision.type !== 'execute' && decision.type !== 'execute_batch') {
          observations.push({
            decision,
            error: 'Planner returned an unknown decision type. Planner must retry with execute, execute_batch, complete, or blocked.',
          });
          return false;
        }

        const execution = await executePlannerDecision({
          decision,
          workerRuntime,
          workerModel,
          workspacePath,
          chatHistory: chatHistory || [],
          maxSteps: maxSteps || 20,
          previousObservations: observations,
          abortSignal: signal,
          onStatus: (status: string) => {
            event.sender.send('agent:update', { type: 'status', data: status, runId });
          },
          onLog: (log: string) => {
            console.log(`[Agent Log] ${log.trim()}`);
            event.sender.send('agent:terminal-log', { runId, log });
          },
          onWorkerApiCall: () => {
            event.sender.send('agent:update', { type: 'api-call', data: 'worker', runId });
          },
          onStep: (stepData: any) => {
            event.sender.send('agent:update', { type: 'agent-step', data: stepData, runId });
          },
          onModelWait: () => {
            event.sender.send('agent:update', { type: 'model-wait-start', runId });
          },
          onOpenBrowser: (url: string) => {
            openBrowserPreview(url);
          },
          onFileUpdated: (filePath: string, payload?: any) => {
            event.sender.send('agent:file-updated', { filePath, ...payload });
            const newTree = buildFileTree(workspacePath);
            event.sender.send('agent:update', { type: 'fs-state', data: newTree, runId });
          },
          onTaskResult: (result: string) => {
            event.sender.send('agent:update', { type: 'subtask-result', data: result, runId });
          },
          onRefreshFileTree: () => {
            const newTree = buildFileTree(workspacePath);
            event.sender.send('agent:update', { type: 'fs-state', data: newTree, runId });
          },
        });
        throwIfAborted(signal);

        observations.push(...execution.observations);
        return false;
      };

      if (initialPlanResult.decision) {
        if (await handleDecision(initialPlanResult.decision)) {
          return 'All tasks completed';
        }
      } else {
        observations.push({
          error: 'Initial Planner response did not include decision. Planner must return execute, execute_batch, complete, or blocked.',
        });
      }

      for (let decisionIndex = 1; decisionIndex < maxControllerDecisions; decisionIndex++) {
        throwIfAborted(signal);
        event.sender.send('agent:update', {
          type: 'status',
          data: 'Planner reviewing completed Worker batch...',
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
        throwIfAborted(signal);

        if (await handleDecision(decision)) {
          return 'All tasks completed';
        }
      }

      sendFinalResult(`Blocked: reached Planner decision limit (${maxControllerDecisions}) before completion.`);
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
