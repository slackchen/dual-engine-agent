const fs = require('fs');

// App.tsx
let app = fs.readFileSync('src/App.tsx', 'utf8');
app = app.replace("    setChatInput('');\n", "");
app = app.replace("    setHistoryIndex(-1);\n", "");
app = app.replace("  const [isEditingBaseUrl, setIsEditingBaseUrl] = useState(false);\n", "");
app = app.replace("  const [showApiKey, setShowApiKey] = useState(false);\n", "");
fs.writeFileSync('src/App.tsx', app);

// SettingsModal.tsx
let settings = fs.readFileSync('src/components/SettingsModal.tsx', 'utf8');
settings = settings.replace("setProvider: (p: string) => void;", "setProvider: (p: 'openai' | 'sensenova' | 'anthropic' | 'google') => void;");
settings = settings.replace("setGoogleAuthMethod: (m: string) => void;", "setGoogleAuthMethod: (m: 'key' | 'oauth') => void;");
fs.writeFileSync('src/components/SettingsModal.tsx', settings);

// task.ts
let task = fs.readFileSync('electron/ipc/task.ts', 'utf8');
task = task.replace("async (event, { runId }) =>", "async (_event, { runId }) =>");
fs.writeFileSync('electron/ipc/task.ts', task);

// worker.ts
let worker = fs.readFileSync('electron/worker.ts', 'utf8');
worker = worker.replace("import { isStepCount, isToolCall, ToolCall } from 'ai';", "import { isToolCall, ToolCall } from 'ai';");
fs.writeFileSync('electron/worker.ts', worker);

// ChatInputBox.tsx
let cib = fs.readFileSync('src/components/ChatInputBox.tsx', 'utf8');
cib = cib.replace("import React, { useState, memo } from 'react';", "import { useState, memo } from 'react';");
fs.writeFileSync('src/components/ChatInputBox.tsx', cib);

// HistoryModal.tsx
let hist = fs.readFileSync('src/components/HistoryModal.tsx', 'utf8');
hist = hist.replace("import { Conversation, Message } from '../types';", "import { Conversation } from '../types';");
fs.writeFileSync('src/components/HistoryModal.tsx', hist);

// ToolCallView.tsx
let tcv = fs.readFileSync('src/components/ToolCallView.tsx', 'utf8');
tcv = tcv.replace("  const isReadFile = toolCall.toolName === 'read_file';\n", "");
fs.writeFileSync('src/components/ToolCallView.tsx', tcv);
