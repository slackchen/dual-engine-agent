import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';

export type RequiredTool =
  | 'readFile'
  | 'createFile'
  | 'writeFile'
  | 'editFileContent'
  | 'runCommand'
  | 'openBrowser'
  | 'launchApp';

export interface PlannerDecision {
  type: 'execute' | 'complete' | 'blocked';
  summary: string;
  task?: {
    id: string;
    description: string;
    requiredTool?: RequiredTool;
    successCriteria: string;
    failurePolicy: string;
  };
  completionEvidence?: {
    source: 'conversation_only' | 'tool_observation';
    observationIndexes?: number[];
    notes: string;
  };
  finalResponse?: string;
  reason?: string;
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
    abortSignal?: AbortSignal
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

      const { text } = await generateText({
        model,
        abortSignal,
        system,
        messages: retryMessages
      });

      const cleanJson = this.extractJson(text);
      try {
        return JSON.parse(cleanJson);
      } catch {
        lastError = new Error(`${label}: attempt ${attempt} returned invalid JSON. Snippet: ${cleanJson.substring(0, 200)}`);
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

  /**
   * Build an initial user-visible plan. Execution is controlled later by decideNextAction.
   */
  public async plan(
    protocol: string,
    authMethod: string,
    tokenOrKey: string,
    modelName: string,
    userRequest: string,
    baseUrl: string,
    chatHistory: any[],
    abortSignal?: AbortSignal
  ) {
    const model = this.createModel(protocol, authMethod, tokenOrKey, modelName, baseUrl);
    const systemPrompt = `You are the Planner AI for a Dual-Engine Agent desktop application.
Your job is to summarize the user's intent and produce a concise high-level plan.
Execution will be controlled by you later through step-by-step decisions; the Worker model may be weak and must not own strategic decisions.

Worker capabilities:
1. File tools: readFile, createFile, writeFile, editFileContent.
2. Command tool: runCommand for short-lived shell commands, builds, checks, and diagnostics.
3. Browser tool: openBrowser for HTML files, localhost, or URLs.
4. App tool: launchApp for native GUI apps, compiled executables, and C++ games.

Important routing:
- Native apps, compiled executables, and C++/SFML games must be launched with launchApp.
- Web pages and HTML games must be opened with openBrowser.
- runCommand is for short commands only; it must not be used to run long-lived GUI games.
- The initial plan has no tool observations. Never claim that a file was changed, a command ran, a browser opened, or an app launched.
- If the request asks to open, run, launch, preview, build, test, inspect files, create files, or edit files, return at least one subtask.

If the user's request is just greeting or general chat that needs no tools, return an empty subtasks array and put the response in summary.

Return ONLY this JSON schema:
{
  "summary": "Brief high-level plan or direct response",
  "subtasks": [
    {
      "id": "short-id",
      "description": "High-level step for the user-visible plan",
      "expected_output": "Expected outcome"
    }
  ]
}`;

    return await this.generateJson(
      'Initial plan',
      model,
      systemPrompt,
      [
        ...chatHistory,
        { role: 'user', content: userRequest }
      ],
      abortSignal
    );
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
    abortSignal?: AbortSignal
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
- Return "execute" when another tool action is required.
- Return "complete" only after observations prove the user request is fulfilled.
- Return "blocked" when the task cannot proceed and explain the blocker.
- If observations are empty, you cannot complete any request that requires file, command, browser, or app actions.
- With empty observations, "complete" is allowed only for pure conversation/information answers. In that case set completionEvidence.source to "conversation_only" and do not claim any external action happened.
- When completing after work was done, set completionEvidence.source to "tool_observation" and include the observationIndexes that prove completion.
- For "open/run/launch/preview" requests, do not complete after only checking files or processes. Complete only after a successful launchApp for native executables/games or successful openBrowser for web pages.
- For native C++/SFML games, inspect/build with runCommand if needed, then launch with launchApp.
- For web fallback, explicitly decide openBrowser.
- Do not ask Worker to choose fallback policy. You choose fallback based on observations.

Return ONLY this JSON schema:
{
  "type": "execute | complete | blocked",
  "summary": "What you decided and why",
  "task": {
    "id": "short-id",
    "description": "Concrete Worker instruction for one step",
    "requiredTool": "readFile | createFile | writeFile | editFileContent | runCommand | openBrowser | launchApp",
    "successCriteria": "How to judge this step from the tool result",
    "failurePolicy": "Return the exact observation to Planner; do not choose fallback"
  },
  "completionEvidence": {
    "source": "conversation_only | tool_observation",
    "observationIndexes": [0],
    "notes": "Why this proves completion"
  },
  "finalResponse": "For complete or blocked decisions, user-facing response",
  "reason": "For blocked decisions"
}`;

    const decision = await this.generateJson(
      'Planner decision',
      model,
      systemPrompt,
      [
        ...chatHistory,
        {
          role: 'user',
          content: JSON.stringify({
            userRequest,
            workspacePath: context.workspacePath,
            initialPlan: context.initialPlan,
            observations: context.observations,
            decisionIndex: context.decisionIndex
          })
        }
      ],
      abortSignal
    );

    return decision as PlannerDecision;
  }
}
