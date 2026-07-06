import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';

import { createFSTools } from './tools/fs';
import { createShellTools } from './tools/shell';
import { createBrowserTools } from './tools/browser';
import { createAppTools } from './tools/app';
import type { RequiredTool } from './planner';

const HARD_STEP_LIMIT = 100;
const MIN_TOOL_STEP_LIMIT = 6;
const SAME_TOOL_FAILURE_LOOP_LIMIT = 4;

function getStepToolResults(step: any) {
  if (Array.isArray(step?.toolResults)) return step.toolResults;
  if (Array.isArray(step?.results)) return step.results;
  return [];
}

function getToolResultPayload(result: any) {
  return result?.output ?? result?.result ?? result;
}

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
    onModelWait: () => void,
    onOpenBrowser: (url: string) => void,
    onFileUpdated: (filePath: string, payload?: { startLine?: number; endLine?: number; oldContent?: string; newContent?: string; isEdit?: boolean }) => void,
    baseUrl: string,
    chatHistory: any[],
    maxSteps: number,
    requiredTool?: RequiredTool,
    abortSignal?: AbortSignal
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
      let stopReason: string | null = null;
      const configuredMaxSteps = Number.isFinite(maxSteps) ? maxSteps : 20;
      const hardStepLimit = Math.min(Math.max(configuredMaxSteps, MIN_TOOL_STEP_LIMIT), HARD_STEP_LIMIT);
      const plannerControlledMode = !!requiredTool;

      const { text } = await generateText({
        model,
        abortSignal,
        prepareStep: ({ stepNumber }) => (
          stepNumber === 0
            ? requiredTool
              ? { activeTools: [requiredTool as any], toolChoice: 'required' as const }
              : { toolChoice: 'required' as const }
            : undefined
        ),
        stopWhen: ({ steps }) => {
          if (plannerControlledMode && steps.length >= 1) {
            stopReason = `Completed required ${requiredTool} tool action.`;
            return true;
          }

          // Hard safety limit for total steps per subtask to prevent infinite loops
          if (steps.length >= hardStepLimit) {
            stopReason = `Stopped after reaching the tool step limit (${hardStepLimit}).`;
            return true;
          }

          // Check if the LLM is stuck in a retry loop for the same tool
          const retryLimit = SAME_TOOL_FAILURE_LOOP_LIMIT;
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
              const results = getStepToolResults(s);
              const res = results.length === 1 ? results[0] : null;
              const resObj = res ? getToolResultPayload(res) : null;
              return resObj && resObj.success === false;
            });
            
            if (allFailed) {
              stopReason = `Stopped after ${retryLimit} consecutive failed ${toolName} attempts.`;
              return true;
            }
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
                 commandSuccess: resObj?.commandSuccess,
                 exitCode: resObj?.exitCode,
                 pid: resObj?.pid,
                 message: resObj?.error || resObj?.message || 'Completed',
                 url: resObj?.url,
                 filePath: resObj?.filePath,
                 displayPath: resObj?.displayPath,
                 content: resObj?.content,
                 startLine: resObj?.startLine,
                 endLine: resObj?.endLine,
                 linesAdded: resObj?.linesAdded,
                 linesRemoved: resObj?.linesRemoved,
                 actualOldContent: resObj?.actualOldContent,
                 actualNewContent: resObj?.actualNewContent
               }
             }) : []
          };
          onStep(stepData);
          if (stepData.results.length > 0) {
            onModelWait();
          }
        },
        system: `You are an AI Worker with direct access to the user's real filesystem and terminal.
Workspace Path: ${workspacePath}
You have access to the conversation history. Use it to understand references to past actions or previously discussed files.
Your goal is to complete the user's task by reading files, writing files, and running terminal commands.
Always ensure you are operating within the workspace.
Runtime OS: ${process.platform === 'win32' ? 'Windows. The runCommand tool executes commands with Windows PowerShell.' : `${process.platform}. The runCommand tool executes commands with the platform shell.`}

CRITICAL INSTRUCTION: When mentioning file names, paths, shell commands, or technical variables in your responses, you MUST wrap them in markdown backticks (e.g. \`src/App.tsx\`, \`npm install\`). This ensures the UI properly syntax-highlights them.


CRITICAL RULES:
1. MUST use \`readFile\` to read files. NEVER use \`cat\` or \`less\` via \`runCommand\`.
2. MUST use \`createFile\`, \`editFileContent\`, or \`writeFile\` to create or modify files. NEVER use \`sed\`, \`awk\`, \`echo\`, \`cat\`, or redirection via \`runCommand\` for file operations.
3. MUST use \`openBrowser\` to preview HTML or web apps. NEVER use \`open\` via \`runCommand\`.
4. You are the Worker, not the Planner. Do not return a plan as your final answer when the subtask requires execution. Use tools to do the work, then report what you actually did.
5. If a command fails because the syntax is for the wrong shell, immediately retry once with the correct shell syntax for this OS.
6. A failed tool call is not the end of the task. Use the failure message to choose a different diagnostic or correction step. If you are genuinely blocked, explain the blocker in the final response instead of silently stopping.
7. For \`runCommand\`, \`success\` means the shell tool ran. Check \`commandSuccess\`, \`exitCode\`, and \`message\` to decide whether the command itself succeeded. Non-zero exit codes can be expected for diagnostic probes.
8. MUST use \`launchApp\` to start desktop GUI applications, compiled executables, or native games. NEVER use \`runCommand\` for long-running GUI apps because it waits for process completion.
9. If the task asks to open, run, launch, or preview something, do not finish after only checking files or processes. Finish only after a successful \`launchApp\` for executables/native games or a successful \`openBrowser\` for web pages, unless you are blocked and explain why.
10. If the task text includes a required tool, use that exact tool for the first action.
11. When the task text includes a required tool, do exactly one tool action and then stop. Do not choose fallback tools, do not run diagnostics after the required tool, and do not retry with a different tool. The Planner will decide the next action from the tool result.

COMMAND TOOL ARGUMENTS:
- \`runCommand\`: use exactly \`{ "command": "..." }\`.
- On Windows, commands run in PowerShell. Use PowerShell syntax such as \`Get-ChildItem -Recurse -Filter *.cpp\`, \`Select-Object -First 20\`, and \`Select-String\`.
- On Windows, do not use Unix-only commands or syntax such as \`find . -name\`, \`head\`, \`grep\`, \`2>/dev/null\`, \`/tmp\`, or POSIX path separators unless the command is known to be available in the project.
- Prefer workspace-relative paths. Do not search broad parent directories unless the task explicitly requires it.

FILE TOOL ARGUMENTS:
- \`readFile\`: use exactly \`{ "filePath": "relative/path.ext" }\`.
- \`createFile\` and \`writeFile\`: use exactly \`{ "filePath": "relative/path.ext", "content": "..." }\`.
- \`editFileContent\`: use exactly \`{ "filePath": "relative/path.ext", "targetContent": "exact existing text", "replacementContent": "new text" }\`.
- Always prefer a path relative to the workspace, such as \`src/App.tsx\` or \`js/main.js\`.
- Before calling \`editFileContent\`, read the file first and copy an exact, unique block into \`targetContent\`. Do not use ellipses or summaries in \`targetContent\`.
- Do not invent argument names such as \`filename\`, \`filepath\`, \`file\`, or \`target\`. The canonical key is \`filePath\`.
- If \`editFileContent\` fails with "Target content not found", your previous file view is stale. Immediately call \`readFile\` for that same file, then retry once with a fresh exact block from the latest file content. Do not retry the same \`targetContent\`.
- If a file was just edited or written earlier in this task, read it again before making another targeted edit to that file.

BROWSER TOOL ARGUMENTS:
- \`openBrowser\`: use exactly \`{ "urlOrFilePath": "index.html" }\` for a local file, or \`{ "urlOrFilePath": "http://localhost:5173/" }\` for a web URL.
- For local previews, prefer a workspace-relative HTML path such as \`index.html\`. Do not pass an empty object.

APP TOOL ARGUMENTS:
- \`launchApp\`: use exactly \`{ "filePath": "build/Debug/tank_battle.exe" }\` or another workspace-relative executable path.
- Use \`launchApp\` after building a native C++/SFML game when the user asks to open, run, or launch the game.`,
        messages: [
          ...chatHistory,
          { role: 'user', content: `Task: ${taskDescription}` }
        ],
        tools: {
          ...createFSTools(workspacePath, onLog, onFileUpdated),
          ...createShellTools(workspacePath, onLog, abortSignal),
          ...createBrowserTools(workspacePath, onLog, onOpenBrowser),
          ...createAppTools(workspacePath, onLog)
        }
      });
      // Return only the final text, the UI handles intermediate steps via onStep callback
      return text || stopReason || 'Subtask completed (no final text generated).';
      
    } catch (err: any) {
      throw new Error(`Worker execution failed: ${err.message}`);
    }
  }
}
