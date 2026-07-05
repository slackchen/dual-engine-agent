const fs = require('fs');

// task.ts
let task = fs.readFileSync('electron/ipc/task.ts', 'utf8');
task = task.replace("async (event, { runId }) => {", "async (_event, { runId }) => {");
fs.writeFileSync('electron/ipc/task.ts', task);

// worker.ts
let worker = fs.readFileSync('electron/worker.ts', 'utf8');
worker = worker.replace("import { isStepCount, isToolCall, ToolCall } from 'ai';", "import { isToolCall, ToolCall } from 'ai';");
fs.writeFileSync('electron/worker.ts', worker);

// ToolCallView.tsx
let tcv = fs.readFileSync('src/components/ToolCallView.tsx', 'utf8');
tcv = tcv.replace("  const isReadFile = toolCall.toolName === 'read_file';\n", "");
fs.writeFileSync('src/components/ToolCallView.tsx', tcv);
