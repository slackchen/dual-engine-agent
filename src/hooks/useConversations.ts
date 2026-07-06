import { useState, useEffect } from 'react';
import { Message, Conversation } from '../types';

const INIT_MESSAGE: Message = {
  id: 'init',
  role: 'ai',
  content: 'Hello! I am your Dual-Engine Agent. Please configure your auth below, then tell me what to build.',
  statusLogs: [],
  agentSteps: [],
  apiCallCount: 0,
  plannerApiCallCount: 0,
  workerApiCallCount: 0,
  isComplete: true,
};

export function useConversations(workspacePath: string) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string>(Date.now().toString());
  const [messages, setMessages] = useState<Message[]>([INIT_MESSAGE]);
  const [isHistoryLoaded, setIsHistoryLoaded] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  // Load chat history when workspace changes
  useEffect(() => {
    const loadHistory = async () => {
      setIsHistoryLoaded(false);
      // @ts-ignore
      if (typeof window.ipcRenderer !== 'undefined' && workspacePath) {
        try {
          // @ts-ignore
          const loaded = await window.ipcRenderer.invoke('agent:load-chat-history', { workspacePath });
          if (loaded && loaded.length > 0) {
            setConversations(loaded);
            setCurrentConversationId(loaded[0].id);
            setMessages(loaded[0].messages.map((m: any) => ({ ...m, isComplete: true })));
          } else {
            setConversations([]);
            setCurrentConversationId(Date.now().toString());
            setMessages([INIT_MESSAGE]);
          }
        } catch (e) {
          console.error('Failed to load history', e);
        }
      } else {
        setConversations([]);
        setCurrentConversationId(Date.now().toString());
        setMessages([INIT_MESSAGE]);
      }
      setIsHistoryLoaded(true);
    };
    loadHistory();
  }, [workspacePath]);

  // Sync conversation list + persist to backend whenever messages change
  useEffect(() => {
    if (!isHistoryLoaded || !workspacePath) return;
    setConversations(prev => {
      if (messages.length <= 1) return prev;
      let title = 'New Conversation';
      const firstUserMsg = messages.find(m => m.role === 'user');
      if (firstUserMsg?.content) {
        title = firstUserMsg.content.substring(0, 30) + (firstUserMsg.content.length > 30 ? '...' : '');
      }
      const idx = prev.findIndex(c => c.id === currentConversationId);
      let updated = [...prev];
      if (idx !== -1) {
        updated[idx] = { ...updated[idx], title, messages, updatedAt: Date.now() };
      } else {
        updated.unshift({ id: currentConversationId, title, messages, updatedAt: Date.now() });
      }
      updated.sort((a, b) => b.updatedAt - a.updatedAt);
      // @ts-ignore
      if (typeof window.ipcRenderer !== 'undefined') {
        // @ts-ignore
        window.ipcRenderer.invoke('agent:save-chat-history', { workspacePath, conversations: updated }).catch(console.error);
      }
      return updated;
    });
  }, [messages, currentConversationId, isHistoryLoaded, workspacePath]);

  const handleNewChat = () => {
    setCurrentConversationId(Date.now().toString());
    setMessages([INIT_MESSAGE]);
  };

  return {
    conversations, setConversations,
    currentConversationId, setCurrentConversationId,
    messages, setMessages,
    isHistoryLoaded,
    isHistoryOpen, setIsHistoryOpen,
    handleNewChat,
  };
}
