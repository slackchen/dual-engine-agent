const fs = require('fs');

let content = fs.readFileSync('src/App.tsx', 'utf8');

// 1. Remove states
content = content.replace("  const [chatInput, setChatInput] = useState('');\n", "");
content = content.replace("  const [historyIndex, setHistoryIndex] = useState(-1);\n", "");

// 2. Add import
content = content.replace(
  "import { AgentStepView } from './components/AgentStepView';",
  "import { AgentStepView } from './components/AgentStepView';\nimport { ChatInputBox } from './components/ChatInputBox';"
);

// 3. Update handleSend
const handleSendOld = `  const handleSend = async () => {`;
const handleSendNew = `  const handleSend = async (userTask: string) => {`;
content = content.replace(handleSendOld, handleSendNew);

const handleSendInputCheckOld = `    if (!chatInput.trim()) return;`;
const handleSendInputCheckNew = `    if (!userTask || !userTask.trim()) return;`;
content = content.replace(handleSendInputCheckOld, handleSendInputCheckNew);

const handleSendClearOld = `    const userTask = chatInput;
    setChatInput('');
    setHistoryIndex(-1);`;
const handleSendClearNew = ``;
content = content.replace(handleSendClearOld, handleSendClearNew);

// 4. Replace DOM block
const chatInputStart = `<div className="chat-input" style={{ background: 'var(--bg-secondary)', padding: '10px' }}>`;
const chatInputEndStr = `</button>
              )}
            </div>
          </div>`;
const startIndex = content.indexOf(chatInputStart);
const endIndex = content.indexOf(chatInputEndStr);

if (startIndex !== -1 && endIndex !== -1) {
  content = content.slice(0, startIndex) +
    `<ChatInputBox 
            onSend={handleSend}
            isRunning={isRunning}
            handleStop={handleStop}
            messages={messages}
            plannerModel={plannerModel}
            setPlannerModel={setPlannerModel}
            workerModel={workerModel}
            setWorkerModel={setWorkerModel}
            availableModels={availableModels}
          />` +
    content.slice(endIndex + chatInputEndStr.length);
} else {
  console.log("Could not find chat input block");
}

fs.writeFileSync('src/App.tsx', content);
console.log("Patched App.tsx with ChatInputBox");
