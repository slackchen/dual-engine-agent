import React from 'react';
import { Conversation, Message } from '../types';

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversations: Conversation[];
  currentConversationId: string | null;
  onSelectConversation: (conv: Conversation) => void;
  onDeleteConversation: (convId: string) => void;
}

export const HistoryModal: React.FC<HistoryModalProps> = ({
  isOpen,
  onClose,
  conversations,
  currentConversationId,
  onSelectConversation,
  onDeleteConversation
}) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000}}>
      <div className="modal-content" style={{backgroundColor: 'var(--bg-secondary)', padding: '20px', borderRadius: '8px', width: '400px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', maxHeight: '80vh'}}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2>Chat History</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontSize: '20px', cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ maxHeight: '400px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {conversations.length === 0 ? (
            <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '20px' }}>No chat history found.</div>
          ) : (
            conversations.map(conv => (
              <div key={conv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', background: 'var(--bg-secondary)', borderRadius: '6px', border: currentConversationId === conv.id ? '1px solid var(--accent)' : '1px solid var(--border-color)' }}>
                <div 
                  style={{ flex: 1, cursor: 'pointer', overflow: 'hidden' }}
                  onClick={() => onSelectConversation(conv)}
                >
                  <div style={{ fontWeight: 'bold', fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{conv.title}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{new Date(conv.updatedAt).toLocaleString()} • {conv.messages.length} msgs</div>
                </div>
                <button 
                  onClick={() => onDeleteConversation(conv.id)}
                  style={{ background: 'transparent', color: '#F44336', border: 'none', cursor: 'pointer', padding: '4px', marginLeft: '10px' }}
                  title="Delete Conversation"
                >
                  🗑️
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
