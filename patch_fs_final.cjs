const fs = require('fs');

// 1. Fix fs.ts
let fsts = fs.readFileSync('electron/tools/fs.ts', 'utf8');
const exactLine = `            const endLine = startLine + newReplacementLines - 1;`;
const exactNewLine = `            const newReplacementLines = replacementContent.replace(/\\r\\n/g, '\\n').split('\\n').length;
            const endLine = startLine + newReplacementLines - 1;`;
fsts = fsts.replace(exactLine, exactNewLine);
fs.writeFileSync('electron/tools/fs.ts', fsts);

// 2. Fix task.ts
let task = fs.readFileSync('electron/ipc/task.ts', 'utf8');
task = task.replace("async (event, { runId }) => {", "async (_event, { runId }) => {");
fs.writeFileSync('electron/ipc/task.ts', task);

// 3. Fix worker.ts
let worker = fs.readFileSync('electron/worker.ts', 'utf8');
worker = worker.replace("import { isStepCount, isToolCall, ToolCall } from 'ai';", "import { isToolCall, ToolCall } from 'ai';");
fs.writeFileSync('electron/worker.ts', worker);

// 4. Fix ToolCallView.tsx
let tcv = fs.readFileSync('src/components/ToolCallView.tsx', 'utf8');
tcv = tcv.replace("  const isReadFile = toolCall.toolName === 'read_file';\n", "");
fs.writeFileSync('src/components/ToolCallView.tsx', tcv);
