import { useState, memo } from 'react';
import { Message } from '../types';

interface ChatInputBoxProps {
  onSend: (userTask: string) => void;
  isRunning: boolean;
  handleStop: () => void;
  messages: Message[];
  plannerModel: string;
  setPlannerModel: (m: string) => void;
  workerModel: string;
  setWorkerModel: (m: string) => void;
  availableModels: string[];
}

export const ChatInputBox = memo(({
  onSend,
  isRunning,
  handleStop,
  messages,
  plannerModel,
  setPlannerModel,
  workerModel,
  setWorkerModel,
  availableModels
}: ChatInputBoxProps) => {
  const [chatInput, setChatInput] = useState('');
  const [historyIndex, setHistoryIndex] = useState(-1);

  return (
    <div className="chat-input" style={{ background: 'var(--bg-secondary)', padding: '10px' }}>
      <textarea 
        className="chat-input-textarea"
        placeholder="Ask the Dual-Engine Agent to do something..." 
        value={chatInput}
        onChange={e => {
          setChatInput(e.target.value);
          setHistoryIndex(-1);
        }}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (chatInput.trim()) {
              onSend(chatInput);
              setChatInput('');
              setHistoryIndex(-1);
            }
          } else if (e.key === 'ArrowUp') {
            const rawUserHistory = messages.filter(m => m.role === 'user').map(m => m.content);
            const userHistory = rawUserHistory.filter((content, index, arr) => index === 0 || content !== arr[index - 1]);
            if (userHistory.length > 0) {
               e.preventDefault();
               const nextIndex = historyIndex < userHistory.length - 1 ? historyIndex + 1 : historyIndex;
               setHistoryIndex(nextIndex);
               setChatInput(userHistory[userHistory.length - 1 - nextIndex]);
            }
          } else if (e.key === 'ArrowDown') {
            const rawUserHistory = messages.filter(m => m.role === 'user').map(m => m.content);
            const userHistory = rawUserHistory.filter((content, index, arr) => index === 0 || content !== arr[index - 1]);
            if (historyIndex > 0) {
               e.preventDefault();
               const nextIndex = historyIndex - 1;
               setHistoryIndex(nextIndex);
               setChatInput(userHistory[userHistory.length - 1 - nextIndex]);
            } else if (historyIndex === 0) {
               e.preventDefault();
               setHistoryIndex(-1);
               setChatInput('');
            }
          }
        }}
        style={{ width: '100%', boxSizing: 'border-box' }}
      />
      <div className="chat-input-toolbar">
        <div className="models">
          <select 
            value={plannerModel} 
            onChange={e => setPlannerModel(e.target.value)}
            title="Main Engine (Planner Model)"
            style={{
              background: 'transparent',
              color: 'var(--text-secondary)',
              border: 'none',
              fontSize: '11px',
              maxWidth: '120px',
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            <option value="">(Main) Auto</option>
            {availableModels.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <select 
            value={workerModel} 
            onChange={e => setWorkerModel(e.target.value)}
            title="Sub Engine (Worker Model)"
            style={{
              background: 'transparent',
              color: 'var(--text-secondary)',
              border: 'none',
              fontSize: '11px',
              maxWidth: '120px',
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            <option value="">(Sub) Auto</option>
            {availableModels.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        {isRunning ? (
          <button
            onClick={handleStop}
            style={{ background: '#dc3545', color: 'white', border: 'none', padding: '6px 16px', borderRadius: '4px', cursor: 'pointer' }}
          >
            ⏹ Stop
          </button>
        ) : (
          <button onClick={() => {
            if (chatInput.trim()) {
              onSend(chatInput);
              setChatInput('');
              setHistoryIndex(-1);
            }
          }} disabled={!chatInput.trim()}>Send</button>
        )}
      </div>
    </div>
  );
});
