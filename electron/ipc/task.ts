import { ipcMain } from 'electron';
import { PlannerEngine } from '../planner';
import { PlanSessionEngine } from '../planSession';
import { buildFileTree } from './workspace';
import { openBrowserPreview } from './browser';
import {
  formatDecisionResult,
  isValidCompleteDecision,
  normalizeInitialPlan,
} from '../execution/decisionUtils';
import { executePlannerDecision } from '../execution/workerScheduler';
import { traceEvent } from '../debugTrace';

const MAX_CONTROLLER_DECISIONS = 20;

const approvedPlanToExecutionPlan = (approvedPlan: any) => normalizeInitialPlan({
  summary: typeof approvedPlan?.summary === 'string' && approvedPlan.summary.trim()
    ? approvedPlan.summary
    : typeof approvedPlan?.title === 'string' && approvedPlan.title.trim()
      ? approvedPlan.title
      : 'Approved plan',
  subtasks: Array.isArray(approvedPlan?.steps)
    ? approvedPlan.steps.map((step: any, index: number) => ({
        id: typeof step?.id === 'string' && step.id.trim() ? step.id : `step-${index + 1}`,
        description: [
          typeof step?.title === 'string' ? step.title : `Step ${index + 1}`,
          typeof step?.description === 'string' && step.description.trim() ? step.description : '',
        ].filter(Boolean).join(': '),
        expected_output: typeof step?.expectedOutcome === 'string' ? step.expectedOutcome : '',
      }))
    : [],
});

export function registerTaskHandlers() {
  const planner = new PlannerEngine();
  const planSession = new PlanSessionEngine();
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
    traceEvent({
      runId,
      source: 'controller',
      phase: 'lifecycle',
      title: 'Stop requested',
    });
    if (abortControllers[runId]) {
      abortControllers[runId].abort();
      delete abortControllers[runId];
    }
  });

  ipcMain.handle('agent:plan-session-step', async (event, arg) => {
    const {
      protocol,
      authMethod,
      tokenOrKey,
      plannerModel,
      workspacePath,
      baseUrl,
      chatHistory,
      runId,
      plannerConfig,
      userRequest,
      planHistory,
      userReply,
    } = arg;
    if (!userRequest) return 'Error: User request is required';

    const fallbackConfig = { protocol, authMethod, tokenOrKey, baseUrl };
    const plannerRuntime = getEngineConfig(plannerConfig, fallbackConfig);
    const abortController = new AbortController();
    abortControllers[runId] = abortController;
    const signal = abortController.signal;

    try {
      traceEvent({
        runId,
        source: 'controller',
        phase: 'lifecycle',
        title: 'Plan session started',
        data: {
          plannerModel,
          plannerRuntime,
          userRequest,
          workspacePath,
          planHistory,
          userReply,
        },
      });
      event.sender.send('agent:update', { type: 'status', data: 'Plan Mode: thinking through the plan...', runId });
      event.sender.send('agent:update', { type: 'api-call', data: 'planner', runId });

      const result = await planSession.step(
        plannerRuntime.protocol,
        plannerRuntime.authMethod,
        plannerRuntime.tokenOrKey,
        plannerModel,
        plannerRuntime.baseUrl,
        {
          userRequest,
          workspacePath,
          chatHistory: chatHistory || [],
          planHistory: planHistory || [],
          userReply,
        },
        signal,
        { runId }
      );
      throwIfAborted(signal);
      return result;
    } catch (err: any) {
      if (err.name === 'AbortError' || (err.message && err.message.includes('AbortError'))) {
        return 'Stopped by user';
      }
      return `Error: ${err.message}`;
    } finally {
      delete abortControllers[runId];
    }
  });

  ipcMain.handle('agent:run-task', async (event, arg) => {
    const { protocol, authMethod, tokenOrKey, plannerModel, workerModel, task, workspacePath, baseUrl, chatHistory, maxSteps, runId, plannerConfig, workerConfig, approvedPlan } = arg;
    if (!task) return 'Error: Task is required';

    const fallbackConfig = { protocol, authMethod, tokenOrKey, baseUrl };
    const plannerRuntime = getEngineConfig(plannerConfig, fallbackConfig);
    const workerRuntime = getEngineConfig(workerConfig, fallbackConfig);

    const abortController = new AbortController();
    abortControllers[runId] = abortController;
    const signal = abortController.signal;

    try {
      traceEvent({
        runId,
        source: 'controller',
        phase: 'lifecycle',
        title: 'Agent run started',
        data: {
          task,
          workspacePath,
          plannerModel,
          workerModel,
          plannerRuntime,
          workerRuntime,
          approvedPlan,
          maxSteps,
          chatHistory,
        },
      });
      event.sender.send('agent:update', {
        type: 'status',
        data: approvedPlan ? 'Preparing approved plan for execution...' : 'Planning executable batch...',
        runId,
      });
      event.sender.send('agent:update', { type: 'api-call', data: 'planner', runId });

      const plan = approvedPlan
        ? approvedPlanToExecutionPlan(approvedPlan)
        : normalizeInitialPlan({
            summary: '',
            subtasks: [],
          });
      const initialDecision = approvedPlan
        ? await planner.decideFromApprovedPlan(
            plannerRuntime.protocol,
            plannerRuntime.authMethod,
            plannerRuntime.tokenOrKey,
            plannerModel,
            task,
            plannerRuntime.baseUrl,
            chatHistory || [],
            { workspacePath, approvedPlan },
            signal,
            { runId }
          )
        : null;

      let initialPlanResult: any = null;
      if (!approvedPlan) {
        initialPlanResult = await planner.planAndDecide(
          plannerRuntime.protocol,
          plannerRuntime.authMethod,
          plannerRuntime.tokenOrKey,
          plannerModel,
          task,
          plannerRuntime.baseUrl,
          chatHistory || [],
          { workspacePath },
          signal,
          { runId }
        );
        plan.summary = initialPlanResult.summary;
        plan.subtasks = initialPlanResult.subtasks;
      }
      throwIfAborted(signal);

      event.sender.send('agent:update', { type: 'plan', data: plan, runId });

      const observations: any[] = [];
      const maxControllerDecisions = Math.min(Math.max(maxSteps || MAX_CONTROLLER_DECISIONS, 1), MAX_CONTROLLER_DECISIONS);
      let finalResultText = '';
      const sendFinalResult = (fallbackText: string) => {
        throwIfAborted(signal);
        finalResultText = fallbackText;
        event.sender.send('agent:update', { type: 'final-result', data: fallbackText, runId });
      };
      const completedResult = () => ({
        status: 'completed',
        finalResult: finalResultText,
      });

      const handleDecision = async (decision: any) => {
        traceEvent({
          runId,
          source: 'controller',
          phase: 'status',
          title: 'Planner decision received',
          data: {
            decision,
            observationCount: observations.length,
          },
        });

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
          const finalText = formatDecisionResult(decision);
          traceEvent({
            runId,
            source: 'controller',
            phase: 'response',
            title: 'Planner completed task',
            data: { decision, finalText },
          });
          sendFinalResult(finalText);
          return true;
        }

        if (decision.type === 'blocked') {
          const finalText = formatDecisionResult(decision);
          traceEvent({
            runId,
            source: 'controller',
            phase: 'response',
            title: 'Planner blocked task',
            data: { decision, finalText },
          });
          sendFinalResult(finalText);
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
          runId,
          decision,
          workerRuntime,
          workerModel,
          userRequest: task,
          workspacePath,
          chatHistory: chatHistory || [],
          maxSteps: maxSteps || 20,
          previousObservations: observations,
          abortSignal: signal,
          onStatus: (status: string) => {
            traceEvent({
              runId,
              source: 'controller',
              phase: 'status',
              title: status,
            });
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

      const firstDecision = approvedPlan ? initialDecision : initialPlanResult?.decision;
      if (firstDecision) {
        if (await handleDecision(firstDecision)) {
          return completedResult();
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
          signal,
          { runId }
        );
        throwIfAborted(signal);

        if (await handleDecision(decision)) {
          return completedResult();
        }
      }

      sendFinalResult(`Blocked: reached Planner decision limit (${maxControllerDecisions}) before completion.`);
      return completedResult();
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
      traceEvent({
        runId,
        source: 'controller',
        phase: 'error',
        title: 'Agent run failed',
        data: {
          error: err,
          message: errMsg,
        },
      });
      return `Error: ${errMsg}`;
    } finally {
      delete abortControllers[runId];
    }
  });
}
