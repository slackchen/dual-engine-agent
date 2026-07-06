import http from 'node:http';
import { randomUUID } from 'node:crypto';

const LISTEN_HOST = '127.0.0.1';
const LISTEN_PORT = 18765;
const CONVERT_MODELS = new Set([
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.4-xhigh',
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
]);

type JsonRecord = Record<string, any>;

let server: http.Server | null = null;

const readBody = (req: http.IncomingMessage) => new Promise<Buffer>((resolve, reject) => {
  const chunks: Buffer[] = [];
  req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

const sendJson = (res: http.ServerResponse, status: number, body: JsonRecord) => {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
  });
  res.end(payload);
};

const sendRaw = async (res: http.ServerResponse, upstream: Response) => {
  const payload = Buffer.from(await upstream.arrayBuffer());
  res.writeHead(upstream.status, {
    'Content-Type': upstream.headers.get('content-type') || 'application/json',
    'Content-Length': payload.length,
  });
  res.end(payload);
};

const normalizeBaseUrl = (baseUrl: string) => {
  let next = baseUrl.replace(/\/+$/, '');
  if (next.endsWith('/chat/completions')) next = next.slice(0, -'/chat/completions'.length);
  return next;
};

const shortId = () => randomUUID().replace(/-/g, '').slice(0, 24);

const upstreamRoot = (baseUrl: string) => {
  const normalized = normalizeBaseUrl(baseUrl);
  return normalized.endsWith('/v1') ? normalized.slice(0, -3) : normalized;
};

const parseProxyUrl = (rawUrl = '') => {
  const match = rawUrl.match(/^\/proxy\/([^/]+)(\/.*)?$/);
  if (!match) return null;
  return {
    upstreamBaseUrl: normalizeBaseUrl(decodeURIComponent(match[1])),
    upstreamPath: match[2] || '/',
  };
};

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) return String((part as JsonRecord).text || '');
        return '';
      })
      .join('');
  }
  return JSON.stringify(content ?? '');
};

const contentParts = (content: unknown) => {
  if (typeof content === 'string') return [{ type: 'input_text', text: content }];
  if (!Array.isArray(content)) return [{ type: 'input_text', text: JSON.stringify(content ?? '') }];

  const parts: JsonRecord[] = content.flatMap<JsonRecord>(part => {
    if (!part || typeof part !== 'object') return [];
    const item = part as JsonRecord;
    if (item.type === 'text' || item.type === 'input_text') return [{ type: 'input_text', text: item.text || '' }];
    if (item.type === 'image_url') {
      const imageUrl = typeof item.image_url === 'object' ? item.image_url?.url : item.image_url;
      return [{ type: 'input_image', image_url: imageUrl || '' }];
    }
    return [];
  });

  return parts.length > 0 ? parts : [{ type: 'input_text', text: '' }];
};

const messagesToResponsesInput = (messages: JsonRecord[]) => {
  const items: JsonRecord[] = [];

  for (const message of messages) {
    const role = message.role;
    const content = message.content;

    if (role === 'tool') {
      items.push({
        type: 'function_call_output',
        call_id: message.tool_call_id || '',
        output: typeof content === 'string' ? content : JSON.stringify(content ?? ''),
      });
      continue;
    }

    if (role === 'assistant') {
      if (content) {
        items.push({
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: textOf(content) }],
        });
      }

      for (const toolCall of message.tool_calls || []) {
        const fn = toolCall.function || {};
        items.push({
          type: 'function_call',
          call_id: toolCall.id || '',
          name: fn.name || '',
          arguments: fn.arguments || '',
        });
      }
      continue;
    }

    if (role === 'system') continue;

    items.push({
      type: 'message',
      role: role || 'user',
      content: contentParts(content),
    });
  }

  return items;
};

const convertChatToResponses = (body: JsonRecord) => {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const systemTexts = messages
    .filter((message: JsonRecord) => message.role === 'system' && message.content)
    .map((message: JsonRecord) => textOf(message.content));

  const output: JsonRecord = {
    model: body.model,
    stream: true,
    input: messagesToResponsesInput(messages),
  };

  if (systemTexts.length > 0) output.instructions = systemTexts.join('\n\n');

  const tools = Array.isArray(body.tools) ? body.tools : [];
  const responseTools = tools.flatMap((tool: JsonRecord) => {
    if (tool.type && tool.type !== 'function') return 'name' in tool ? [tool] : [];
    const fn = tool.function || tool;
    if (!fn.name) return [];
    return [{
      type: 'function',
      name: fn.name,
      description: fn.description || '',
      parameters: fn.parameters || {},
      ...(fn.strict !== undefined ? { strict: fn.strict } : {}),
    }];
  });
  if (responseTools.length > 0) output.tools = responseTools;

  if (body.tool_choice !== undefined) output.tool_choice = body.tool_choice;
  if (body.temperature !== undefined) output.temperature = body.temperature;
  if (body.top_p !== undefined) output.top_p = body.top_p;
  if (body.max_tokens !== undefined) output.max_output_tokens = body.max_tokens;
  if (body.max_completion_tokens !== undefined) output.max_output_tokens = body.max_completion_tokens;
  if (body.reasoning_effort) output.reasoning = { effort: body.reasoning_effort };
  if (body.reasoning) output.reasoning = typeof body.reasoning === 'object' ? body.reasoning : { effort: body.reasoning };

  return output;
};

const parseSseEvents = (raw: string) => {
  const events: Array<{ type: string; data: JsonRecord }> = [];
  let currentType = '';
  let dataLines: string[] = [];

  const flush = () => {
    if (!currentType) return;
    const blob = dataLines.join('');
    try {
      events.push({ type: currentType, data: blob ? JSON.parse(blob) : {} });
    } catch {
      events.push({ type: currentType, data: { _raw: blob } });
    }
    currentType = '';
    dataLines = [];
  };

  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('event:')) currentType = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    else if (!line.trim()) flush();
  }
  flush();
  return events;
};

const responsesEventsToChatCompletion = (model: string, events: Array<{ type: string; data: JsonRecord }>) => {
  const textParts: string[] = [];
  const functionCalls = new Map<number, { id: string; name: string; arguments: string }>();
  let responseId = '';
  let finishReason = 'stop';
  let usage: JsonRecord | null = null;

  for (const event of events) {
    const { type, data } = event;
    if (type === 'response.output_text.delta') {
      textParts.push(data.delta || '');
    } else if (type === 'response.output_item.added') {
      const item = data.item || {};
      if (item.type === 'function_call') {
        const index = Number(data.output_index || 0);
        functionCalls.set(index, {
          id: item.call_id || `call_${shortId()}`,
          name: item.name || '',
          arguments: '',
        });
      }
    } else if (type === 'response.function_call_arguments.delta') {
      const index = Number(data.output_index || 0);
      const current = functionCalls.get(index) || { id: '', name: '', arguments: '' };
      current.arguments += data.delta || '';
      functionCalls.set(index, current);
    } else if (type === 'response.function_call_arguments.done') {
      const index = Number(data.output_index || 0);
      const current = functionCalls.get(index);
      if (current && data.arguments) current.arguments = data.arguments;
    } else if (type === 'response.output_item.done') {
      const item = data.item || {};
      if (item.type === 'function_call') {
        const index = Number(data.output_index || 0);
        const current = functionCalls.get(index) || { id: '', name: '', arguments: '' };
        functionCalls.set(index, {
          id: item.call_id || current.id || `call_${shortId()}`,
          name: item.name || current.name,
          arguments: item.arguments || current.arguments || '{}',
        });
      }
    } else if (type === 'response.completed') {
      const response = data.response || {};
      responseId = response.id || '';
      usage = response.usage || null;
      if (response.status === 'incomplete') finishReason = 'length';
    }
  }

  const orderedCalls = [...functionCalls.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, call]) => ({
      id: call.id || `call_${shortId()}`,
      type: 'function',
      function: {
        name: call.name,
        arguments: call.arguments || '{}',
      },
    }));

  if (orderedCalls.length > 0) finishReason = 'tool_calls';

  const promptTokens = usage?.input_tokens || 0;
  const completionTokens = usage?.output_tokens || 0;

  return {
    id: responseId || `chatcmpl-${shortId()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: textParts.join('') || null,
        ...(orderedCalls.length > 0 ? { tool_calls: orderedCalls } : {}),
      },
      finish_reason: finishReason,
    }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: usage?.total_tokens || promptTokens + completionTokens,
    },
  };
};

const passthrough = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  upstreamBaseUrl: string,
  upstreamPath: string,
  body?: Buffer,
) => {
  const payload = body ?? await readBody(req);
  const upstream = await fetch(upstreamBaseUrl + upstreamPath, {
    method: req.method,
    headers: {
      'Content-Type': req.headers['content-type'] || 'application/json',
      ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
    } as HeadersInit,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : payload as unknown as BodyInit,
  });
  await sendRaw(res, upstream);
};

const handleChatCompletions = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  upstreamBaseUrl: string,
  upstreamPath: string,
) => {
  const rawBody = await readBody(req);
  let body: JsonRecord;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    sendJson(res, 400, { error: { message: 'invalid JSON body' } });
    return;
  }

  const model = body.model || '';
  if (!CONVERT_MODELS.has(model)) {
    await passthrough(req, res, upstreamBaseUrl, upstreamPath, rawBody);
    return;
  }

  const responsesBody = convertChatToResponses(body);
  const upstream = await fetch(`${upstreamRoot(upstreamBaseUrl)}/v1/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
    } as HeadersInit,
    body: JSON.stringify(responsesBody),
  });

  if (!upstream.ok) {
    await sendRaw(res, upstream);
    return;
  }

  const events = parseSseEvents(await upstream.text());
  sendJson(res, 200, responsesEventsToChatCompletion(model, events));
};

export const getBuiltInResponsesProxyBaseUrl = (upstreamBaseUrl: string) =>
  `http://${LISTEN_HOST}:${LISTEN_PORT}/proxy/${encodeURIComponent(normalizeBaseUrl(upstreamBaseUrl))}`;

export const startBuiltInResponsesProxy = () => {
  if (server) return;

  server = http.createServer(async (req, res) => {
    try {
      const parsed = parseProxyUrl(req.url || '');
      if (!parsed) {
        sendJson(res, 404, { error: { message: 'unknown proxy route' } });
        return;
      }

      if (req.method === 'GET' && parsed.upstreamPath === '/health') {
        sendJson(res, 200, { status: 'ok', convert_models: [...CONVERT_MODELS] });
        return;
      }

      if (req.method === 'POST' && parsed.upstreamPath.endsWith('/chat/completions')) {
        await handleChatCompletions(req, res, parsed.upstreamBaseUrl, parsed.upstreamPath);
        return;
      }

      await passthrough(req, res, parsed.upstreamBaseUrl, parsed.upstreamPath);
    } catch (error: any) {
      sendJson(res, 502, { error: { message: error?.message || String(error) } });
    }
  });

  server.listen(LISTEN_PORT, LISTEN_HOST, () => {
    console.log(`[BuiltInResponsesProxy] listening on http://${LISTEN_HOST}:${LISTEN_PORT}`);
  });

  server.on('error', (error) => {
    console.error('[BuiltInResponsesProxy] failed to start', error);
  });
};
