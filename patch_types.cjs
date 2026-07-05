const fs = require('fs');

// MessageList.tsx
let msg = fs.readFileSync('src/components/MessageList.tsx', 'utf8');
msg = msg.replace(
  "setDiffState: React.Dispatch<React.SetStateAction<{original: string, modified: string} | null>>;",
  "setDiffState: React.Dispatch<React.SetStateAction<{original: string, modified: string, startLine?: number} | null>>;"
);
fs.writeFileSync('src/components/MessageList.tsx', msg);

// AgentStepView.tsx
let asv = fs.readFileSync('src/components/AgentStepView.tsx', 'utf8');
asv = asv.replace(
  "setDiffState: React.Dispatch<React.SetStateAction<{original: string, modified: string} | null>>;",
  "setDiffState: React.Dispatch<React.SetStateAction<{original: string, modified: string, startLine?: number} | null>>;"
);
fs.writeFileSync('src/components/AgentStepView.tsx', asv);

// ToolCallView.tsx
let tcv = fs.readFileSync('src/components/ToolCallView.tsx', 'utf8');
tcv = tcv.replace(
  "setDiffState: React.Dispatch<React.SetStateAction<{original: string, modified: string} | null>>;",
  "setDiffState: React.Dispatch<React.SetStateAction<{original: string, modified: string, startLine?: number} | null>>;"
);
// Also update the button onClick where it calls setDiffState
tcv = tcv.replace(
  "setDiffState({ original: res.actualOldContent, modified: res.actualNewContent });",
  "setDiffState({ original: res.actualOldContent, modified: res.actualNewContent });" // No change needed for now unless we want to pass startLine
);
fs.writeFileSync('src/components/ToolCallView.tsx', tcv);

console.log("Patched component prop types");
