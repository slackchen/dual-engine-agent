export interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileNode[];
}

export interface Message {
  id: string;
  role: 'user' | 'ai';
  content: string;
  statusLogs: string[];
  agentSteps: any[];
  apiCallCount: number;
  plannerApiCallCount?: number;
  workerApiCallCount?: number;
  isComplete?: boolean;
  plan?: any;
  finalSummary?: string;
  modelWaitStartedAt?: number | null;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
}
