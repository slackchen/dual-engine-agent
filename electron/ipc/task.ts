import { ipcMain } from 'electron';
import { PlannerEngine } from '../planner';
import { WorkerEngine } from '../worker';
import { buildFileTree } from './workspace';
import { openBrowserPreview } from './browser';

export function registerTaskHandlers() {
  const planner = new PlannerEngine();
  const worker = new WorkerEngine();

  ipcMain.handle('agent:run-task', async (event, arg) => {
    const { protocol, authMethod, tokenOrKey, plannerModel, workerModel, task, workspacePath, baseUrl, chatHistory, maxSteps, runId } = arg;
    if (!task) return 'Error: Task is required';

    try {
      event.sender.send('agent:update', { type: 'status', data: 'Planning subtasks...', runId });
      event.sender.send('agent:update', { type: 'api-call', runId });
      
      const plan = await planner.plan(
        protocol,
        authMethod,
        tokenOrKey, 
        plannerModel, 
        task, 
        baseUrl,
        chatHistory || []
      );
      
      event.sender.send('agent:update', { type: 'plan', data: plan, runId });
      
      const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      let runningContext = '';

      for (const sub of plan.subtasks) {
        await sleep(2000);
        event.sender.send('agent:update', { type: 'status', data: `Executing: ${sub.description}`, runId });
        
        const taskPrompt = `Task: ${sub.description}\n\nContext from previous subtasks:\n${runningContext || 'None'}`;
        
        const result = await worker.executeTask(
          protocol,
          authMethod,
          tokenOrKey, 
          workerModel, 
          taskPrompt, 
          workspacePath, 
          (log: string) => {
            // Also print to the main process console so we can see it in terminal!
            console.log(`[Agent Log] ${log.trim()}`);
            event.sender.send('agent:terminal-log', log);
          },
          (stepData: any) => {
             event.sender.send('agent:update', { type: 'api-call', runId });
             event.sender.send('agent:update', { type: 'agent-step', data: stepData, runId });
          },
          (url: string) => {
             openBrowserPreview(url);
          },
          (filePath: string, payload?: any) => {
             event.sender.send('agent:file-updated', { filePath, ...payload });
             const newTree = buildFileTree(workspacePath);
             event.sender.send('agent:update', { type: 'fs-state', data: newTree, runId });
          },
          baseUrl,
          chatHistory || [],
          maxSteps || 20
        );
        
        runningContext += `[Subtask]: ${sub.description}\n[Result]: ${typeof result === 'string' ? result : JSON.stringify(result)}\n\n`;
        
        event.sender.send('agent:update', { type: 'subtask-result', data: result, runId });
        
        const newTree = buildFileTree(workspacePath);
        event.sender.send('agent:update', { type: 'fs-state', data: newTree, runId });
      }
      
      return 'All tasks completed';
    } catch (err: any) {
      let errMsg = err.message;
      if (errMsg.includes('GenerateRequestsPerDayPerProjectPerModel-FreeTier')) {
        errMsg = "Google Gemini Free Tier Daily Quota Exceeded (Limit: 20 requests/day). Please switch to OpenAI or a paid API Key.";
      } else if (errMsg.includes('QuotaFailure') || errMsg.includes('429')) {
        errMsg = "API Rate Limit or Quota Exceeded. Please slow down or check your API key balance.";
      }
      await new Promise(r => setTimeout(r, 150));
      return `Error: ${errMsg}`;
    }
  });
}
