import React from 'react';

interface ContextMenuProps {
  x: number;
  y: number;
  isDir: boolean;
  onAction: (action: 'newFile' | 'newDir' | 'rename' | 'delete' | 'reveal') => void;
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, isDir, onAction, onClose }) => {
  return (
    <div 
      className="context-menu" 
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      {isDir && (
        <>
          <div className="context-menu-item" onClick={() => { onAction('newFile'); onClose(); }}>📄 New File</div>
          <div className="context-menu-item" onClick={() => { onAction('newDir'); onClose(); }}>📁 New Folder</div>
          <div className="context-menu-separator"></div>
        </>
      )}
      <div className="context-menu-item" onClick={() => { onAction('rename'); onClose(); }}>✏️ Rename</div>
      <div className="context-menu-item" onClick={() => { onAction('reveal'); onClose(); }}>🔍 Reveal in OS</div>
      <div className="context-menu-separator"></div>
      <div className="context-menu-item danger" onClick={() => { onAction('delete'); onClose(); }}>🗑️ Delete</div>
    </div>
  );
};
