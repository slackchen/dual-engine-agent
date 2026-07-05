import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';

export class PlannerEngine {
  /**
   * Decompose a user request into a sequence of executable subtasks.
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
    let model;
    
    if (protocol === 'google') {
      if (authMethod === 'google-oauth') {
        const openai = createOpenAI({
          baseURL: baseUrl,
          apiKey: tokenOrKey
        });
        model = openai(modelName || 'gemini-1.5-pro-latest');
      } else {
        const google = createGoogleGenerativeAI({
          baseURL: baseUrl,
          apiKey: tokenOrKey
        });
        model = google(modelName || 'gemini-1.5-pro-latest');
      }
    } else if (protocol === 'anthropic') {
      const anthropic = createAnthropic({
        baseURL: baseUrl,
        apiKey: tokenOrKey
      });
      model = anthropic(modelName || 'claude-3-5-sonnet-20240620');
    } else {
      // Default to OpenAI Compatible
      const openai = createOpenAI({ 
        baseURL: baseUrl,
        apiKey: tokenOrKey
      });
      model = openai.chat(modelName || 'gpt-4o');
    }

    const MAX_RETRIES = 3;
    let lastError: Error | null = null;
    let retryMessages = [
      ...chatHistory,
      { role: 'user', content: userRequest }
    ];

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const systemPrompt = attempt === 1
          ? `You are the Planner AI for a Dual-Engine Agent desktop application.
Your job is to break down the user's latest complex request into a series of simple, atomic subtasks.
You have access to the conversation history. Use it to understand references like "do it again" or "fix this".
These subtasks will be sent one by one to a Worker AI that runs inside a Node.js sandbox.
The Worker has the following capabilities:
1. Read and Write local files in the workspace using dedicated file system tools (NEVER use shell commands like cat, echo, or sed for file operations).
2. Run shell commands (e.g., npm install, node script.js).
3. Open a web browser to preview a local HTML file or web URL using its internal openBrowser tool (Very important if the user asks to "open", "preview", or "view" a webpage/HTML).

IMPORTANT: If the user's request is just a greeting (like "hello", "hi") or general conversational chat that does not require any execution or coding, you MUST return an empty subtasks array []. Do not invent subtasks for greetings. Just write a friendly conversational response in the "summary" field.

CRITICAL INSTRUCTION: When mentioning file names, paths, shell commands, or technical variables in your "summary" or "description" fields, you MUST wrap them in markdown backticks (e.g. \`src/App.tsx\`, \`npm install\`). This ensures the UI properly syntax-highlights them.

CRITICAL INSTRUCTION: You MUST respond strictly with a raw JSON object matching the schema below. DO NOT output any markdown headings, markdown lists, or conversational text outside the JSON object.
{
  "summary": "A brief summary of the overall plan",
  "subtasks": [
    {
      "id": "Unique ID for this subtask",
      "description": "Detailed instruction of what needs to be done by the Worker",
      "expected_output": "What this task should produce or return"
    }
  ]
}

Provide a sequential plan as a JSON object.`
          : `IMPORTANT CORRECTION (Attempt ${attempt}/${MAX_RETRIES}): Your previous response was not valid JSON. You MUST output ONLY a raw JSON object — no markdown, no headings, no explanation.

Start your response with { and end with }. Nothing else.

Required schema:
{
  "summary": "...",
  "subtasks": [{ "id": "...", "description": "...", "expected_output": "..." }]
}

Try again now.`;

        const { text } = await generateText({
          model,
          abortSignal,
          system: systemPrompt,
          messages: retryMessages
        });

        let cleanJson = text.trim();
        
        // Try to extract from a markdown code block first
        const jsonBlockMatch = cleanJson.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonBlockMatch && jsonBlockMatch[1]) {
          cleanJson = jsonBlockMatch[1].trim();
        } else {
          // Fallback: robustly extract the JSON object by finding the outermost braces
          const firstBrace = cleanJson.search(/[{[]/);
          const lastBrace = Math.max(cleanJson.lastIndexOf('}'), cleanJson.lastIndexOf(']'));
          if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            cleanJson = cleanJson.substring(firstBrace, lastBrace + 1);
          }
        }

        try {
          return JSON.parse(cleanJson);
        } catch (parseError) {
          // JSON parsing failed — prepare retry context by appending bad output and correction request
          lastError = new Error(`Attempt ${attempt}: model output was not valid JSON. Snippet: ${cleanJson.substring(0, 200)}`);
          console.warn(`[Planner] Retry ${attempt}/${MAX_RETRIES}: JSON parse failed.`, lastError.message);
          retryMessages = [
            ...chatHistory,
            { role: 'user', content: userRequest },
            { role: 'assistant', content: text },
            { role: 'user', content: `Your response was not valid JSON. Please output ONLY a raw JSON object starting with { and ending with }. No markdown, no headings, no extra text.` }
          ];
          // Continue to next attempt
        }
      } catch (err: any) {
        // Network / API error — don't retry, throw immediately
        console.error('[Planner Error]', err);
        throw new Error(`Failed to generate plan: ${err.message}`);
      }
    }

    // All retries exhausted
    throw new Error(`Failed to generate plan: model repeatedly failed to produce valid JSON after ${MAX_RETRIES} attempts. Last error: ${lastError?.message}`);
  }
}
