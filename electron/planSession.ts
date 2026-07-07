import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { traceEvent } from './debugTrace';

export interface PlanOption {
  id: string;
  label: string;
  description: string;
}

export interface PlanQuestion {
  id: string;
  question: string;
  options: PlanOption[];
  allowCustom: boolean;
}

export interface PlanStep {
  id: string;
  title: string;
  description: string;
  expectedOutcome: string;
}

export interface PlanDraft {
  title: string;
  summary: string;
  steps: PlanStep[];
  assumptions: string[];
  risks: string[];
}

export interface PlanSessionTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface PlanSessionState {
  status: 'needs_input' | 'final';
  assistantMessage: string;
  questions: PlanQuestion[];
  draftPlan: PlanDraft | null;
  finalPlan: PlanDraft | null;
}

interface PlanSessionTraceContext {
  runId?: string;
  protocol: string;
  modelName: string;
  baseUrl: string;
}

const emptyPlan = (): PlanDraft => ({
  title: 'Plan',
  summary: '',
  steps: [],
  assumptions: [],
  risks: [],
});

const normalizePlan = (value: any): PlanDraft | null => {
  if (!value || typeof value !== 'object') return null;

  return {
    title: typeof value.title === 'string' && value.title.trim() ? value.title : 'Plan',
    summary: typeof value.summary === 'string' ? value.summary : '',
    steps: Array.isArray(value.steps)
      ? value.steps.map((step: any, index: number) => ({
          id: typeof step?.id === 'string' && step.id.trim() ? step.id : `step-${index + 1}`,
          title: typeof step?.title === 'string' ? step.title : `Step ${index + 1}`,
          description: typeof step?.description === 'string' ? step.description : '',
          expectedOutcome: typeof step?.expectedOutcome === 'string' ? step.expectedOutcome : '',
        }))
      : [],
    assumptions: Array.isArray(value.assumptions) ? value.assumptions.filter((item: any) => typeof item === 'string') : [],
    risks: Array.isArray(value.risks) ? value.risks.filter((item: any) => typeof item === 'string') : [],
  };
};

const normalizeQuestions = (value: any): PlanQuestion[] => {
  if (!Array.isArray(value)) return [];

  return value.slice(0, 3).map((question: any, questionIndex: number) => ({
    id: typeof question?.id === 'string' && question.id.trim() ? question.id : `q-${questionIndex + 1}`,
    question: typeof question?.question === 'string' ? question.question : '',
    options: Array.isArray(question?.options)
      ? question.options.slice(0, 4).map((option: any, optionIndex: number) => ({
          id: typeof option?.id === 'string' && option.id.trim() ? option.id : `o-${optionIndex + 1}`,
          label: typeof option?.label === 'string' ? option.label : `Option ${optionIndex + 1}`,
          description: typeof option?.description === 'string' ? option.description : '',
        }))
      : [],
    allowCustom: question?.allowCustom !== false,
  })).filter(question => question.question.trim());
};

export class PlanSessionEngine {
  private createModel(
    protocol: string,
    authMethod: string,
    tokenOrKey: string,
    modelName: string,
    baseUrl: string
  ) {
    if (protocol === 'google') {
      if (authMethod === 'google-oauth') {
        const openai = createOpenAI({ baseURL: baseUrl, apiKey: tokenOrKey });
        return openai.chat(modelName || 'gemini-1.5-pro-latest');
      }

      const google = createGoogleGenerativeAI({ baseURL: baseUrl, apiKey: tokenOrKey });
      return google(modelName || 'gemini-1.5-pro-latest');
    }

    if (protocol === 'anthropic') {
      const anthropic = createAnthropic({ baseURL: baseUrl, apiKey: tokenOrKey });
      return anthropic(modelName || 'claude-3-5-sonnet-20240620');
    }

    const openai = createOpenAI({ baseURL: baseUrl, apiKey: tokenOrKey });
    return openai.chat(modelName || 'gpt-4o');
  }

  private extractJson(text: string) {
    let cleanJson = text.trim();
    const jsonBlockMatch = cleanJson.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonBlockMatch?.[1]) return jsonBlockMatch[1].trim();

    const firstBrace = cleanJson.search(/[{[]/);
    const lastBrace = Math.max(cleanJson.lastIndexOf('}'), cleanJson.lastIndexOf(']'));
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleanJson = cleanJson.substring(firstBrace, lastBrace + 1);
    }
    return cleanJson;
  }

  private async generateJson(
    model: any,
    systemPrompt: string,
    messages: any[],
    abortSignal?: AbortSignal,
    traceContext?: PlanSessionTraceContext
  ) {
    const maxRetries = 3;
    let retryMessages = messages;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const system = attempt === 1
        ? systemPrompt
        : `${systemPrompt}

IMPORTANT CORRECTION (Attempt ${attempt}/${maxRetries}): Your previous response was not valid JSON.
Output ONLY a raw JSON object. Start with { and end with }. No markdown, headings, or extra text.`;

      traceEvent({
        runId: traceContext?.runId,
        source: 'plan-session',
        phase: 'request',
        title: 'Plan session request',
        data: {
          attempt,
          protocol: traceContext?.protocol,
          modelName: traceContext?.modelName,
          baseUrl: traceContext?.baseUrl,
          system,
          messages: retryMessages,
        },
      });

      const startedAt = Date.now();
      let text = '';
      try {
        const result = await generateText({
          model,
          abortSignal,
          system,
          messages: retryMessages,
        });
        text = result.text;
      } catch (error) {
        traceEvent({
          runId: traceContext?.runId,
          source: 'plan-session',
          phase: 'error',
          title: 'Plan session request failed',
          data: {
            attempt,
            durationMs: Date.now() - startedAt,
            error,
          },
        });
        throw error;
      }

      traceEvent({
        runId: traceContext?.runId,
        source: 'plan-session',
        phase: 'response',
        title: 'Plan session response',
        data: {
          attempt,
          durationMs: Date.now() - startedAt,
          text,
        },
      });

      const cleanJson = this.extractJson(text);
      try {
        return JSON.parse(cleanJson);
      } catch {
        lastError = new Error(`Plan session returned invalid JSON. Snippet: ${cleanJson.substring(0, 200)}`);
        traceEvent({
          runId: traceContext?.runId,
          source: 'plan-session',
          phase: 'error',
          title: 'Plan session JSON parse failed',
          data: {
            attempt,
            cleanJson,
            error: lastError,
          },
        });
        retryMessages = [
          ...messages,
          { role: 'assistant', content: text },
          { role: 'user', content: 'Your response was not valid JSON. Output only the required JSON object.' },
        ];
      }
    }

    throw new Error(lastError?.message || 'Plan session model repeatedly failed to produce valid JSON.');
  }

  public async step(
    protocol: string,
    authMethod: string,
    tokenOrKey: string,
    modelName: string,
    baseUrl: string,
    input: {
      userRequest: string;
      workspacePath: string;
      chatHistory: any[];
      planHistory: PlanSessionTurn[];
      userReply?: string;
    },
    abortSignal?: AbortSignal,
    trace?: { runId?: string }
  ): Promise<PlanSessionState> {
    const model = this.createModel(protocol, authMethod, tokenOrKey, modelName, baseUrl);
    const systemPrompt = `You are the Plan Mode facilitator for a Dual-Engine Agent desktop app.

Your job is to help the user shape a plan before any tool execution happens.
You must not claim that files were read, commands ran, code changed, a browser opened, or any tool action happened.

Ask questions only when the answer materially changes the plan. Prefer one question, at most three.
Every question must provide 2-4 meaningful options and allow custom input.
If enough information is available, return a final plan instead of more questions.

Return ONLY this JSON schema:
{
  "status": "needs_input | final",
  "assistantMessage": "Short user-facing explanation",
  "questions": [
    {
      "id": "short-id",
      "question": "Question text",
      "options": [
        { "id": "short-id", "label": "Short option label", "description": "Impact or tradeoff" }
      ],
      "allowCustom": true
    }
  ],
  "draftPlan": {
    "title": "Plan title",
    "summary": "Concise plan summary",
    "steps": [
      {
        "id": "short-id",
        "title": "Step title",
        "description": "What will be done",
        "expectedOutcome": "How this step changes the result"
      }
    ],
    "assumptions": ["Assumption text"],
    "risks": ["Risk or validation gap"]
  },
  "finalPlan": {
    "title": "Plan title",
    "summary": "Concise final plan summary",
    "steps": [
      {
        "id": "short-id",
        "title": "Step title",
        "description": "What will be done",
        "expectedOutcome": "How this step changes the result"
      }
    ],
    "assumptions": ["Assumption text"],
    "risks": ["Risk or validation gap"]
  }
}`;

    const result = await this.generateJson(
      model,
      systemPrompt,
      [
        ...(input.chatHistory || []),
        {
          role: 'user',
          content: JSON.stringify({
            userRequest: input.userRequest,
            workspacePath: input.workspacePath,
            planHistory: input.planHistory || [],
            latestUserReply: input.userReply || '',
          }),
        },
      ],
      abortSignal,
      { runId: trace?.runId, protocol, modelName, baseUrl }
    );

    const status = result.status === 'final' ? 'final' : 'needs_input';
    let questions = status === 'final' ? [] : normalizeQuestions(result.questions);
    const draftPlan = normalizePlan(result.draftPlan) || emptyPlan();
    const finalPlan = status === 'final'
      ? normalizePlan(result.finalPlan) || draftPlan
      : null;

    if (status === 'needs_input' && questions.length === 0) {
      questions = [{
        id: 'confirm-or-adjust',
        question: 'How should I proceed with this draft plan?',
        options: [
          { id: 'use-plan', label: 'Use this plan', description: 'Finalize the current draft so it can be executed.' },
          { id: 'revise-plan', label: 'Revise it', description: 'Provide changes before finalizing the plan.' },
        ],
        allowCustom: true,
      }];
    }

    return {
      status,
      assistantMessage: typeof result.assistantMessage === 'string' ? result.assistantMessage : '',
      questions,
      draftPlan,
      finalPlan,
    };
  }
}
