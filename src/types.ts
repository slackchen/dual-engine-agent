import type { TokenUsageSummary } from './shared/tokenUsage';

export interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileNode[];
}

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

export interface Message {
  id: string;
  role: 'user' | 'ai';
  content: string;
  streamContent?: string;
  statusLogs: string[];
  agentSteps: any[];
  apiCallCount: number;
  plannerApiCallCount?: number;
  workerApiCallCount?: number;
  tokenUsage?: TokenUsageSummary;
  plannerTokenUsage?: TokenUsageSummary;
  workerTokenUsage?: TokenUsageSummary;
  isComplete?: boolean;
  plan?: any;
  finalSummary?: string;
  finalSummaryMode?: 'conversation' | 'summary';
  finalSummaryRevealing?: boolean;
  modelWaitStartedAt?: number | null;
  planModeRequest?: string;
  planSession?: PlanSessionState;
  planSessionHistory?: PlanSessionTurn[];
  planExecutionStarted?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
}
