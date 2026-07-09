export interface ModelMessage {
  role: string;
  content: unknown;
}

export interface CompactModelMessagesOptions {
  maxMessages?: number;
  maxTotalChars?: number;
  maxUserChars?: number;
  maxAssistantChars?: number;
  maxOtherChars?: number;
}

export interface ModelRequestTokenEstimate {
  estimated: true;
  inputTokens: number;
  systemTokens: number;
  messageTokens: number;
  toolTokens: number;
  totalChars: number;
  systemChars: number;
  messageChars: number;
  messageCount: number;
  toolCount: number;
  largestMessageChars: number;
}

const DEFAULT_COMPACT_OPTIONS: Required<CompactModelMessagesOptions> = {
  maxMessages: 10,
  maxTotalChars: 9000,
  maxUserChars: 2400,
  maxAssistantChars: 1400,
  maxOtherChars: 1200,
};

export const MODEL_CONTEXT_BUDGETS = {
  frontendChatHistory: {
    maxMessages: 10,
    maxTotalChars: 9000,
    maxUserChars: 2400,
    maxAssistantChars: 1400,
  },
  plannerInitialHistory: {
    maxMessages: 10,
    maxTotalChars: 9000,
    maxUserChars: 2400,
    maxAssistantChars: 1400,
  },
  plannerReviewHistory: {
    maxMessages: 8,
    maxTotalChars: 7000,
    maxUserChars: 2200,
    maxAssistantChars: 1200,
  },
  planSessionChatHistory: {
    maxMessages: 8,
    maxTotalChars: 6000,
    maxUserChars: 2000,
    maxAssistantChars: 1200,
  },
  planSessionPlanHistory: {
    maxMessages: 8,
    maxTotalChars: 5000,
    maxUserChars: 1600,
    maxAssistantChars: 1400,
  },
  workerHistory: {
    maxMessages: 2,
    maxTotalChars: 1200,
    maxUserChars: 700,
    maxAssistantChars: 400,
  },
} satisfies Record<string, CompactModelMessagesOptions>;

const CJK_PATTERN = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g;

export function stringifyForModelContext(value: unknown) {
  if (typeof value === 'string') return value;
  if (value == null) return '';

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function compactTextForModel(value: unknown, maxChars: number) {
  const text = stringifyForModelContext(value);
  if (maxChars <= 0 || text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 32))}... (${text.length} chars total)`;
}

export function estimateTextTokens(value: unknown) {
  const text = stringifyForModelContext(value);
  if (!text) return 0;

  const cjkCount = text.match(CJK_PATTERN)?.length ?? 0;
  const nonCjkCount = Math.max(text.length - cjkCount, 0);
  return Math.max(1, Math.ceil(cjkCount * 1.1 + nonCjkCount / 4));
}

function getRoleLimit(role: string, options: Required<CompactModelMessagesOptions>) {
  if (role === 'user') return options.maxUserChars;
  if (role === 'assistant') return options.maxAssistantChars;
  return options.maxOtherChars;
}

function getMessageChars(messages: ModelMessage[]) {
  return messages.reduce((sum, message) => sum + stringifyForModelContext(message.content).length, 0);
}

export function compactModelMessages<T extends ModelMessage>(
  messages: T[] | null | undefined,
  options: CompactModelMessagesOptions = {}
): T[] {
  const mergedOptions = { ...DEFAULT_COMPACT_OPTIONS, ...options };
  const normalized = (Array.isArray(messages) ? messages : [])
    .map(message => ({
      ...message,
      role: typeof message.role === 'string' ? message.role : 'user',
      content: stringifyForModelContext(message.content).trim(),
    }))
    .filter(message => message.content);

  let compacted = normalized
    .slice(-mergedOptions.maxMessages)
    .map(message => ({
      ...message,
      content: compactTextForModel(message.content, getRoleLimit(message.role, mergedOptions)),
    }));

  while (compacted.length > 1 && getMessageChars(compacted) > mergedOptions.maxTotalChars) {
    compacted = compacted.slice(1);
  }

  if (compacted.length === 1 && getMessageChars(compacted) > mergedOptions.maxTotalChars) {
    compacted = [{
      ...compacted[0],
      content: compactTextForModel(compacted[0].content, mergedOptions.maxTotalChars),
    }];
  }

  return compacted as T[];
}

export function estimateModelRequestTokens(input: {
  system?: unknown;
  messages?: ModelMessage[] | null;
  tools?: string[] | Record<string, unknown> | null;
}): ModelRequestTokenEstimate {
  const systemText = stringifyForModelContext(input.system);
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const messageTexts = messages.map(message => stringifyForModelContext(message.content));
  const toolCount = Array.isArray(input.tools)
    ? input.tools.length
    : input.tools && typeof input.tools === 'object'
      ? Object.keys(input.tools).length
      : 0;

  const systemTokens = estimateTextTokens(systemText);
  const messageTokens = messageTexts.reduce((sum, text) => sum + estimateTextTokens(text), 0);
  const toolTokens = toolCount * 220;
  const messageChars = messageTexts.reduce((sum, text) => sum + text.length, 0);

  return {
    estimated: true,
    inputTokens: systemTokens + messageTokens + toolTokens,
    systemTokens,
    messageTokens,
    toolTokens,
    totalChars: systemText.length + messageChars,
    systemChars: systemText.length,
    messageChars,
    messageCount: messages.length,
    toolCount,
    largestMessageChars: messageTexts.reduce((max, text) => Math.max(max, text.length), 0),
  };
}
