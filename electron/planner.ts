import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { traceEvent } from './debugTrace';
import { normalizeTokenUsage, type TokenUsageSummary } from '../src/shared/tokenUsage';
import { MODEL_CONTEXT_BUDGETS, compactModelMessages, estimateModelRequestTokens } from '../src/shared/modelContext';
import { compactObservationsForPlanner } from './execution/observationContext';
import { streamTextWithTrace } from './modelStreaming';
import { extractJsonStringField } from './execution/jsonStringFieldStream';

export type RequiredTool =
  | 'readFile'
  | 'createFile'
  | 'writeFile'
  | 'editFileContent'
  | 'runCommand'
  | 'openBrowser'
  | 'launchApp';

export interface PlannerTask {
  id: string;
  description: string;
  requiredTool?: RequiredTool;
  successCriteria: string;
  failurePolicy: string;
  canRunInParallel?: boolean;
  writesFiles?: boolean;
  dependencies?: string[];
}

export interface PlannerDecision {
  type: 'execute' | 'execute_batch' | 'complete' | 'blocked';
  summary: string;
  task?: PlannerTask;
  tasks?: PlannerTask[];
  workerCount?: number;
  completionCriteria?: {
    goal: string;
    satisfiedWhen: string;
    requiredEvidence: string[];
  };
  completionEvidence?: {
    source: 'conversation_only' | 'tool_observation';
    observationIndexes?: number[];
    notes: string;
  };
  finalResponse?: string;
  reason?: string;
}

export interface PlannerPlanResult {
  summary: string;
  subtasks: Array<{
    id: string;
    description: string;
    expected_output: string;
  }>;
  decision: PlannerDecision;
}

interface PlannerTraceContext {
  runId?: string;
  protocol: string;
  modelName: string;
  baseUrl: string;
  onTokenUsage?: (usage: TokenUsageSummary, metadata: Record<string, unknown>) => void;
  onFinalResponseDelta?: (delta: string, metadata: Record<string, unknown>) => void;
  onFinalResponseReset?: (metadata: Record<string, unknown>) => void;
}

export class PlannerEngine {
  private createModel(
    protocol: string,
    authMethod: string,
    tokenOrKey: string,
    modelName: string,
    baseUrl: string
  ) {
    if (protocol === 'google') {
      if (authMethod === 'google-oauth') {
        const openai = createOpenAI({
          baseURL: baseUrl,
          apiKey: tokenOrKey
        });
        return openai(modelName || 'gemini-1.5-pro-latest');
      }

      const google = createGoogleGenerativeAI({
        baseURL: baseUrl,
        apiKey: tokenOrKey
      });
      return google(modelName || 'gemini-1.5-pro-latest');
    }

    if (protocol === 'anthropic') {
      const anthropic = createAnthropic({
        baseURL: baseUrl,
        apiKey: tokenOrKey
      });
      return anthropic(modelName || 'claude-3-5-sonnet-20240620');
    }

    const openai = createOpenAI({
      baseURL: baseUrl,
      apiKey: tokenOrKey
    });
    return openai.chat(modelName || 'gpt-4o');
  }

  private extractJson(text: string) {
    let cleanJson = text.trim();
    const jsonBlockMatch = cleanJson.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonBlockMatch?.[1]) {
      return jsonBlockMatch[1].trim();
    }

    const firstBrace = cleanJson.search(/[{[]/);
    const lastBrace = Math.max(cleanJson.lastIndexOf('}'), cleanJson.lastIndexOf(']'));
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleanJson = cleanJson.substring(firstBrace, lastBrace + 1);
    }
    return cleanJson;
  }

  private async generateJson(
    label: string,
    model: any,
    systemPrompt: string,
    messages: any[],
    abortSignal?: AbortSignal,
    traceContext?: PlannerTraceContext
  ) {
    const MAX_RETRIES = 3;
    let retryMessages = messages;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const system = attempt === 1
        ? systemPrompt
        : `${systemPrompt}

IMPORTANT CORRECTION (Attempt ${attempt}/${MAX_RETRIES}): Your previous response was not valid JSON.
Output ONLY a raw JSON object. Start with { and end with }. No markdown, headings, or extra text.`;

      traceEvent({
        runId: traceContext?.runId,
        source: 'planner',
        phase: 'request',
        title: `${label} request`,
        data: {
          label,
          attempt,
          protocol: traceContext?.protocol,
          modelName: traceContext?.modelName,
          baseUrl: traceContext?.baseUrl,
          requestTokenEstimate: estimateModelRequestTokens({
            system,
            messages: retryMessages,
          }),
          system,
          messages: retryMessages,
        },
      });

      const startedAt = Date.now();
      let text = '';
      let usage: TokenUsageSummary = {};
      let streamedText = '';
      let streamedFinalResponseLength = 0;
      try {
        const result = await streamTextWithTrace({
          model,
          abortSignal,
          system,
          messages: retryMessages
        }, {
          runId: traceContext?.runId,
          source: 'planner',
          title: label,
          metadata: {
            label,
            attempt,
            modelName: traceContext?.modelName,
            protocol: traceContext?.protocol,
          },
          onTextDelta: (delta) => {
            if (!traceContext?.onFinalResponseDelta) return;
            streamedText += delta;
            const extracted = extractJsonStringField(streamedText, 'finalResponse');
            if (!extracted) return;
            const nextValue = extracted.value;
            if (nextValue.length <= streamedFinalResponseLength) return;
            const visibleDelta = nextValue.slice(streamedFinalResponseLength);
            streamedFinalResponseLength = nextValue.length;
            if (visibleDelta) {
              traceContext.onFinalResponseDelta(visibleDelta, {
                label,
                attempt,
                modelName: traceContext.modelName,
                protocol: traceContext.protocol,
              });
            }
          },
        });
        text = result.text;
        usage = normalizeTokenUsage(result.usage);
        traceContext?.onTokenUsage?.(usage, {
          label,
          attempt,
          modelName: traceContext.modelName,
          protocol: traceContext.protocol,
        });
      } catch (error) {
        traceEvent({
          runId: traceContext?.runId,
          source: 'planner',
          phase: 'error',
          title: `${label} request failed`,
          data: {
            label,
            attempt,
            durationMs: Date.now() - startedAt,
            error,
          },
        });
        throw error;
      }

      traceEvent({
        runId: traceContext?.runId,
        source: 'planner',
        phase: 'response',
        title: `${label} response`,
        data: {
          label,
          attempt,
          durationMs: Date.now() - startedAt,
          text,
          usage,
        },
      });

      const cleanJson = this.extractJson(text);
      try {
        return JSON.parse(cleanJson);
      } catch {
        if (streamedFinalResponseLength > 0) {
          traceContext?.onFinalResponseReset?.({
            label,
            attempt,
            modelName: traceContext?.modelName,
            protocol: traceContext?.protocol,
          });
        }
        lastError = new Error(`${label}: attempt ${attempt} returned invalid JSON. Snippet: ${cleanJson.substring(0, 200)}`);
        traceEvent({
          runId: traceContext?.runId,
          source: 'planner',
          phase: 'error',
          title: `${label} JSON parse failed`,
          data: {
            label,
            attempt,
            cleanJson,
            error: lastError,
          },
        });
        console.warn(`[Planner] ${lastError.message}`);
        retryMessages = [
          ...messages,
          { role: 'assistant', content: text },
          { role: 'user', content: 'Your response was not valid JSON. Output only the required JSON object.' }
        ];
      }
    }

    throw new Error(`${label}: model repeatedly failed to produce valid JSON. Last error: ${lastError?.message}`);
  }

  public async planAndDecide(
    protocol: string,
    authMethod: string,
    tokenOrKey: string,
    modelName: string,
    userRequest: string,
    baseUrl: string,
    chatHistory: any[],
    context: {
      workspacePath: string;
    },
    abortSignal?: AbortSignal,
    trace?: {
      runId?: string;
      onTokenUsage?: PlannerTraceContext['onTokenUsage'];
      onFinalResponseDelta?: PlannerTraceContext['onFinalResponseDelta'];
      onFinalResponseReset?: PlannerTraceContext['onFinalResponseReset'];
    }
  ): Promise<PlannerPlanResult> {
    const model = this.createModel(protocol, authMethod, tokenOrKey, modelName, baseUrl);
    const systemPrompt = `You are the Planner Controller for a Dual-Engine Agent desktop application.
In this first Planner call, produce both:
1. A concise user-visible high-level plan.
2. The first concrete execution decision for Worker model(s).

Worker capabilities:
- readFile: read a workspace file.
- createFile/writeFile/editFileContent: create or modify files.
- runCommand: short-lived shell commands, builds, checks, diagnostics. Non-zero exit codes are observations, not necessarily fatal.
- openBrowser: open HTML files, localhost, or URLs.
- launchApp: launch native GUI apps, compiled executables, and C++ games without waiting for exit.

Batching rules:
- Prefer "execute_batch" whenever multiple known single-tool tasks can be planned now.
- Do not split known sequential work across multiple Planner calls. Put sequential tasks in one execute_batch with canRunInParallel false and dependencies when needed; runtime will serialize unsafe tasks.
- Only return a single "execute" when there is truly only one known Worker action.
- Set workerCount to the number of Worker instances you want, but runtime may clamp or serialize based on safety.
- Each Worker task must be one concrete single-tool action and must include requiredTool.
- Mark canRunInParallel true only when the task has no dependency on sibling task results.
- Mark writesFiles true for createFile, writeFile, editFileContent, or any runCommand that may modify files.

Completion rules:
- This initial call has no tool observations. Never claim that a file was changed, a command ran, a browser opened, or an app launched.
- Return "complete" only for pure conversation/information answers that need no tools. Use completionEvidence.source = "conversation_only".
- For complete or blocked decisions, finalResponse is the final summary shown to the user. No separate summary model call will run.
- For requests that require opening/running/previewing/building/testing/reading/editing files, return execute or execute_batch.
- For every execute or execute_batch decision, include completionCriteria. This is the user-level condition that would make the overall request complete after the Worker observations return.
- The executor does not judge completionCriteria. It only executes Worker tasks and returns observations. You will review those observations and decide complete, blocked, or the next execute decision.
- Native apps, compiled executables, and C++/SFML games must be launched with launchApp.
- Use openBrowser only when the user explicitly asks to open, preview, browse, view a web page, run an HTML/web target, or names a URL/index.html as the thing to open.
- For game development, completion, implementation, or fix requests, do not choose openBrowser as the first action. Read, edit, build, or validate the game first.
- If the user asks to develop and preview a web/HTML game, schedule openBrowser only as a final verification step after implementation or validation observations exist.
- runCommand is for short commands only; it must not run long-lived GUI games.

Return ONLY this JSON schema:
{
  "summary": "Brief high-level plan or direct response",
  "subtasks": [
    {
      "id": "short-id",
      "description": "High-level step for the user-visible plan",
      "expected_output": "Expected outcome"
    }
  ],
  "decision": {
    "type": "execute | execute_batch | complete | blocked",
    "summary": "What you decided and why",
    "task": {
      "id": "short-id",
      "description": "Concrete Worker instruction for one step",
      "requiredTool": "readFile | createFile | writeFile | editFileContent | runCommand | openBrowser | launchApp",
      "successCriteria": "How to judge this step from the tool result",
      "failurePolicy": "Return the exact observation to Planner; do not choose fallback",
      "canRunInParallel": false,
      "writesFiles": false,
      "dependencies": []
    },
    "tasks": [
      {
        "id": "short-id",
        "description": "Concrete Worker instruction for one step",
        "requiredTool": "readFile | createFile | writeFile | editFileContent | runCommand | openBrowser | launchApp",
        "successCriteria": "How to judge this step from the tool result",
        "failurePolicy": "Return the exact observation to Planner; do not choose fallback",
        "canRunInParallel": true,
        "writesFiles": false,
        "dependencies": []
      }
    ],
    "workerCount": 2,
    "completionCriteria": {
      "goal": "User-level outcome this execution is trying to satisfy",
      "satisfiedWhen": "Condition the Planner will check against Worker observations",
      "requiredEvidence": ["Concrete evidence fields or facts needed from Worker observations"]
    },
    "completionEvidence": {
      "source": "conversation_only | tool_observation",
      "observationIndexes": [],
      "notes": "Why this proves completion"
    },
    "finalResponse": "For complete or blocked decisions, user-facing response",
    "reason": "For blocked decisions"
  }
}`;

    const modelMessages = [
      ...compactModelMessages(chatHistory, MODEL_CONTEXT_BUDGETS.plannerInitialHistory),
      {
        role: 'user',
        content: JSON.stringify({
          userRequest,
          workspacePath: context.workspacePath
        })
      }
    ];

    const result = await this.generateJson(
      'Initial plan and decision',
      model,
      systemPrompt,
      modelMessages,
      abortSignal,
      {
        runId: trace?.runId,
        protocol,
        modelName,
        baseUrl,
        onTokenUsage: trace?.onTokenUsage,
        onFinalResponseDelta: trace?.onFinalResponseDelta,
        onFinalResponseReset: trace?.onFinalResponseReset,
      }
    );

    return {
      summary: typeof result.summary === 'string' ? result.summary : '',
      subtasks: Array.isArray(result.subtasks) ? result.subtasks : [],
      decision: result.decision as PlannerDecision,
    };
  }

  public async decideNextAction(
    protocol: string,
    authMethod: string,
    tokenOrKey: string,
    modelName: string,
    userRequest: string,
    baseUrl: string,
    chatHistory: any[],
    context: {
      workspacePath: string;
      initialPlan: any;
      observations: any[];
      decisionIndex: number;
    },
    abortSignal?: AbortSignal,
    trace?: {
      runId?: string;
      onTokenUsage?: PlannerTraceContext['onTokenUsage'];
      onFinalResponseDelta?: PlannerTraceContext['onFinalResponseDelta'];
      onFinalResponseReset?: PlannerTraceContext['onFinalResponseReset'];
    }
  ): Promise<PlannerDecision> {
    const model = this.createModel(protocol, authMethod, tokenOrKey, modelName, baseUrl);
    const systemPrompt = `You are the Planner Controller for a Dual-Engine Agent.
You make all strategic decisions. The Worker model may have weak language ability, so every execute decision must be a concrete single-tool task.

Available tools for Worker:
- readFile: read a workspace file.
- createFile/writeFile/editFileContent: create or modify files.
- runCommand: short-lived shell commands, builds, checks, diagnostics. Non-zero exit codes are observations, not necessarily fatal.
- openBrowser: open HTML files, localhost, or URLs.
- launchApp: launch native GUI apps, compiled executables, and C++ games without waiting for exit.

Decision rules:
- You are the only component allowed to decide whether the user request is complete. The executor only runs Worker tasks and reports observations.
- Return "execute" when another tool action is required.
- Return "execute_batch" when multiple independent single-tool tasks can be handled in the same controller decision.
- Prefer "execute_batch" for all currently known next actions. Do not return one execute at a time when multiple next Worker actions are already clear.
- Sequential tasks can still be returned together in execute_batch; set canRunInParallel false and dependencies when needed, and the runtime will serialize unsafe tasks.
- Return "complete" only after observations prove the user request is fulfilled.
- Return "blocked" when the task cannot proceed and explain the blocker.
- If observations are empty, you cannot complete any request that requires file, command, browser, or app actions.
- With empty observations, "complete" is allowed only for pure conversation/information answers. In that case set completionEvidence.source to "conversation_only" and do not claim any external action happened.
- When completing after work was done, set completionEvidence.source to "tool_observation" and include the observationIndexes that prove completion.
- For complete or blocked decisions, finalResponse is the final summary shown to the user. No separate summary model call will run.
- Review the latest decision's completionCriteria, each task's successCriteria, and the Worker observations. If the completionCriteria is satisfied, return complete and summarize the result. If not, choose the next concrete action or blocked.
- Compare every new execute decision against prior observations. Do not repeat a Worker action whose required tool already succeeded and whose result satisfies the task successCriteria, unless the user asked for another distinct target or the prior result does not satisfy the completionCriteria.
- For execute_batch, set workerCount to the number of Worker instances you want. The runtime may clamp or serialize based on safety.
- In execute_batch, each task must still be one concrete single-tool task with requiredTool.
- Mark canRunInParallel true only when the task has no dependency on sibling task results.
- Mark writesFiles true for createFile, writeFile, editFileContent, or any runCommand that may modify files.
- For explicit "open/run/launch/preview" requests, do not complete after only checking files or processes. Complete only after a successful launchApp for native executables/games or successful openBrowser for web pages.
- For native C++/SFML games, inspect/build with runCommand if needed, then launch with launchApp.
- Use openBrowser only when the user explicitly asks to open, preview, browse, view a web page, run an HTML/web target, or names a URL/index.html as the thing to open.
- For game development, completion, implementation, or fix requests, do not choose openBrowser before the game has been implemented or validated. If a prior observation says openBrowser was blocked by tool policy, choose a development or validation task instead of repeating openBrowser.
- Do not ask Worker to choose fallback policy. You choose fallback based on observations.

Return ONLY this JSON schema:
{
  "type": "execute | execute_batch | complete | blocked",
  "summary": "What you decided and why",
  "task": {
    "id": "short-id",
    "description": "Concrete Worker instruction for one step",
    "requiredTool": "readFile | createFile | writeFile | editFileContent | runCommand | openBrowser | launchApp",
    "successCriteria": "How to judge this step from the tool result",
    "failurePolicy": "Return the exact observation to Planner; do not choose fallback",
    "canRunInParallel": false,
    "writesFiles": false,
    "dependencies": []
  },
  "tasks": [
    {
      "id": "short-id",
      "description": "Concrete Worker instruction for one step",
      "requiredTool": "readFile | createFile | writeFile | editFileContent | runCommand | openBrowser | launchApp",
      "successCriteria": "How to judge this step from the tool result",
      "failurePolicy": "Return the exact observation to Planner; do not choose fallback",
      "canRunInParallel": true,
      "writesFiles": false,
      "dependencies": []
    }
  ],
  "workerCount": 2,
  "completionCriteria": {
    "goal": "User-level outcome this execution is trying to satisfy",
    "satisfiedWhen": "Condition the Planner will check against Worker observations",
    "requiredEvidence": ["Concrete evidence fields or facts needed from Worker observations"]
  },
  "completionEvidence": {
    "source": "conversation_only | tool_observation",
    "observationIndexes": [0],
    "notes": "Why this proves completion"
  },
  "finalResponse": "For complete or blocked decisions, user-facing response",
  "reason": "For blocked decisions"
}`;

    const modelMessages = [
      ...compactModelMessages(chatHistory, MODEL_CONTEXT_BUDGETS.plannerReviewHistory),
      {
        role: 'user',
        content: JSON.stringify({
          userRequest,
          workspacePath: context.workspacePath,
          initialPlan: context.initialPlan,
          observations: compactObservationsForPlanner(context.observations),
          decisionIndex: context.decisionIndex
        })
      }
    ];

    const decision = await this.generateJson(
      'Planner decision',
      model,
      systemPrompt,
      modelMessages,
      abortSignal,
      {
        runId: trace?.runId,
        protocol,
        modelName,
        baseUrl,
        onTokenUsage: trace?.onTokenUsage,
        onFinalResponseDelta: trace?.onFinalResponseDelta,
        onFinalResponseReset: trace?.onFinalResponseReset,
      }
    );

    return decision as PlannerDecision;
  }

  public async decideFromApprovedPlan(
    protocol: string,
    authMethod: string,
    tokenOrKey: string,
    modelName: string,
    userRequest: string,
    baseUrl: string,
    chatHistory: any[],
    context: {
      workspacePath: string;
      approvedPlan: any;
    },
    abortSignal?: AbortSignal,
    trace?: {
      runId?: string;
      onTokenUsage?: PlannerTraceContext['onTokenUsage'];
      onFinalResponseDelta?: PlannerTraceContext['onFinalResponseDelta'];
      onFinalResponseReset?: PlannerTraceContext['onFinalResponseReset'];
    }
  ): Promise<PlannerDecision> {
    const model = this.createModel(protocol, authMethod, tokenOrKey, modelName, baseUrl);
    const systemPrompt = `You are the Planner Controller for a Dual-Engine Agent desktop application.

The user has already approved a high-level plan in Plan Mode. Your job is to convert that approved plan into the first concrete execution decision for Worker model(s).
Do not ask questions. Do not claim that files were read, commands ran, code changed, a browser opened, or an app launched.

Worker capabilities:
- readFile: read a workspace file.
- createFile/writeFile/editFileContent: create or modify files.
- runCommand: short-lived shell commands, builds, checks, diagnostics. Non-zero exit codes are observations, not necessarily fatal.
- openBrowser: open HTML files, localhost, or URLs.
- launchApp: launch native GUI apps, compiled executables, and C++ games without waiting for exit.

Decision rules:
- Return "execute" when one concrete Worker action is required.
- Return "execute_batch" when multiple known actions can be planned now.
- Prefer "execute_batch" for all currently known next actions. Sequential tasks may be returned together with canRunInParallel false and dependencies.
- Each Worker task must be one concrete single-tool action and must include requiredTool.
- Set workerCount to the number of Worker instances you want; runtime may clamp or serialize based on safety.
- Mark canRunInParallel true only when the task has no dependency on sibling task results.
- Mark writesFiles true for createFile, writeFile, editFileContent, or any runCommand that may modify files.
- Return "complete" only for pure conversation/information plans that need no tools. Use completionEvidence.source = "conversation_only".
- For requests that require opening/running/previewing/building/testing/reading/editing files, return execute or execute_batch.
- Native apps, compiled executables, and C++/SFML games must be launched with launchApp.
- Use openBrowser only when the user explicitly asks to open, preview, browse, view a web page, run an HTML/web target, or names a URL/index.html as the thing to open.
- For game development, completion, implementation, or fix requests, do not choose openBrowser as the first action. Read, edit, build, or validate the game first.
- If the user asks to develop and preview a web/HTML game, schedule openBrowser only as a final verification step after implementation or validation observations exist.
- runCommand is for short commands only; it must not run long-lived GUI games.
- For every execute or execute_batch decision, include completionCriteria.

Return ONLY this JSON schema:
{
  "type": "execute | execute_batch | complete | blocked",
  "summary": "What you decided and why",
  "task": {
    "id": "short-id",
    "description": "Concrete Worker instruction for one step",
    "requiredTool": "readFile | createFile | writeFile | editFileContent | runCommand | openBrowser | launchApp",
    "successCriteria": "How to judge this step from the tool result",
    "failurePolicy": "Return the exact observation to Planner; do not choose fallback",
    "canRunInParallel": false,
    "writesFiles": false,
    "dependencies": []
  },
  "tasks": [
    {
      "id": "short-id",
      "description": "Concrete Worker instruction for one step",
      "requiredTool": "readFile | createFile | writeFile | editFileContent | runCommand | openBrowser | launchApp",
      "successCriteria": "How to judge this step from the tool result",
      "failurePolicy": "Return the exact observation to Planner; do not choose fallback",
      "canRunInParallel": true,
      "writesFiles": false,
      "dependencies": []
    }
  ],
  "workerCount": 2,
  "completionCriteria": {
    "goal": "User-level outcome this execution is trying to satisfy",
    "satisfiedWhen": "Condition the Planner will check against Worker observations",
    "requiredEvidence": ["Concrete evidence fields or facts needed from Worker observations"]
  },
  "completionEvidence": {
    "source": "conversation_only | tool_observation",
    "observationIndexes": [],
    "notes": "Why this proves completion"
  },
  "finalResponse": "For complete or blocked decisions, user-facing response",
  "reason": "For blocked decisions"
}`;

    const modelMessages = [
      ...compactModelMessages(chatHistory, MODEL_CONTEXT_BUDGETS.plannerReviewHistory),
      {
        role: 'user',
        content: JSON.stringify({
          userRequest,
          workspacePath: context.workspacePath,
          approvedPlan: context.approvedPlan,
        })
      }
    ];

    const decision = await this.generateJson(
      'Approved plan decision',
      model,
      systemPrompt,
      modelMessages,
      abortSignal,
      {
        runId: trace?.runId,
        protocol,
        modelName,
        baseUrl,
        onTokenUsage: trace?.onTokenUsage,
        onFinalResponseDelta: trace?.onFinalResponseDelta,
        onFinalResponseReset: trace?.onFinalResponseReset,
      }
    );

    return decision as PlannerDecision;
  }

}
