import { generateText, isStepCount } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';

import { createFSTools } from './tools/fs';
import { createShellTools } from './tools/shell';
import { createBrowserTools } from './tools/browser';

export class WorkerEngine {
  public async executeTask(
    protocol: string,
    authMethod: string,
    tokenOrKey: string, 
    modelName: string, 
    taskDescription: string,
    workspacePath: string,
    onLog: (log: string) => void,
    onStep: (stepData: any) => void,
    onOpenBrowser: (url: string) => void,
    onFileUpdated: (filePath: string, payload?: { startLine?: number; endLine?: number; oldContent?: string; newContent?: string; isEdit?: boolean }) => void,
    baseUrl: string,
    chatHistory: any[],
    maxSteps: number
  ): Promise<string> {
    if (!workspacePath) {
      throw new Error('No workspace selected. Please open a folder first.');
    }

    let model;
    
    if (protocol === 'google') {
      if (authMethod === 'google-oauth') {
        const openai = createOpenAI({
          baseURL: baseUrl,
          apiKey: tokenOrKey
        });
        model = openai.chat(modelName || 'gemini-1.5-flash-latest');
      } else {
        const google = createGoogleGenerativeAI({
          baseURL: baseUrl,
          apiKey: tokenOrKey
        });
        model = google(modelName || 'gemini-1.5-flash-latest');
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
      model = openai.chat(modelName || 'gpt-4o-mini');
    }

    try {
      const { text } = await generateText({
        model,
        stopWhen: ({ steps }) => {
          // Hard safety limit for total steps per subtask to prevent infinite loops
          if (steps.length >= 100) return true;

          // Check if the LLM is stuck in a retry loop for the same tool
          const retryLimit = maxSteps || 5;
          if (steps.length >= retryLimit) {
            const lastN = steps.slice(-retryLimit);
            
            // Must have exactly 1 tool call per step to be considered a simple retry loop
            const allHaveSingleTool = lastN.every((s: any) => s.toolCalls && s.toolCalls.length === 1);
            if (!allHaveSingleTool) return false;
            
            // Must be the exact same tool name
            const toolName = lastN[0].toolCalls[0].toolName;
            const allSameTool = lastN.every((s: any) => s.toolCalls[0].toolName === toolName);
            if (!allSameTool) return false;
            
            // Every attempt must have resulted in a failure
            const allFailed = lastN.every((s: any) => {
              const res = s.toolResults && s.toolResults.length === 1 ? s.toolResults[0] : null;
              const resObj = res ? (res.output ?? res.result) : null;
              return resObj && resObj.success === false;
            });
            
            if (allFailed) return true;
          }
          
          return false;
        },
        onStepFinish: ({ text, toolCalls, toolResults }) => {
          // Parse structured step data
          // AI SDK v7: toolCall fields use `.input`, toolResult fields use `.output`
          const stepData = {
             thought: text || '',
             actions: toolCalls ? toolCalls.map(c => {
               const cAny = c as any;
               return {
                 toolName: c.toolName,
                 args: cAny.input ?? cAny.args ?? {}
               };
             }) : [],
             results: toolResults ? toolResults.map(r => {
               const rAny = r as any;
               // AI SDK v7 uses `.output`; older versions used `.result`
               const resObj = rAny.output ?? rAny.result;
               const success = resObj?.success ?? true;
               return {
                 toolName: r.toolName,
                 success,
                 message: resObj?.error || resObj?.message || 'Completed',
                 content: resObj?.content,
                 linesAdded: resObj?.linesAdded,
                 linesRemoved: resObj?.linesRemoved
               }
             }) : []
          };
          onStep(stepData);
        },
        system: `You are an AI Worker with direct access to the user's real filesystem and terminal.
Workspace Path: ${workspacePath}
You have access to the conversation history. Use it to understand references to past actions or previously discussed files.
Your goal is to complete the user's task by reading files, writing files, and running terminal commands.
Always ensure you are operating within the workspace.

CRITICAL INSTRUCTION: When mentioning file names, paths, shell commands, or technical variables in your responses, you MUST wrap them in markdown backticks (e.g. \`src/App.tsx\`, \`npm install\`). This ensures the UI properly syntax-highlights them.


CRITICAL RULES:
1. MUST use \`readFile\` to read files. NEVER use \`cat\` or \`less\` via \`runCommand\`.
2. MUST use \`createFile\`, \`editFileContent\`, or \`writeFile\` to create or modify files. NEVER use \`sed\`, \`awk\`, \`echo\`, \`cat\`, or redirection via \`runCommand\` for file operations.
3. MUST use \`openBrowser\` to preview HTML or web apps. NEVER use \`open\` via \`runCommand\`.`,
        messages: [
          ...chatHistory,
          { role: 'user', content: `Task: ${taskDescription}` }
        ],
        tools: {
          ...createFSTools(workspacePath, onLog, onFileUpdated),
          ...createShellTools(workspacePath, onLog),
          ...createBrowserTools(workspacePath, onLog, onOpenBrowser)
        }
      });
      // Return only the final text, the UI handles intermediate steps via onStep callback
      return text || 'Subtask completed (no final text generated).';
      
    } catch (err: any) {
      throw new Error(`Worker execution failed: ${err.message}`);
    }
  }
}
