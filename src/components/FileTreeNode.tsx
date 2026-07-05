import React, { useState, useEffect } from 'react';
import { FileNode } from '../types';

export interface FileTreeNodeProps {
  node: FileNode;
  activeTab: string;
  onSelect: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, path: string, isDir: boolean) => void;
  editingNode: { path: string, type: 'rename' | 'newFile' | 'newDir', initialValue: string } | null;
  onEditComplete: (value: string) => void;
  onEditCancel: () => void;
  depth?: number;
}

export const FileTreeNode = ({ node, activeTab, onSelect, onContextMenu, editingNode, onEditComplete, onEditCancel, depth = 0 }: FileTreeNodeProps) => {
  const [expanded, setExpanded] = useState(false);
  const isRenaming = editingNode?.type === 'rename' && editingNode.path === node.path;
  const isAddingChild = (editingNode?.type === 'newFile' || editingNode?.type === 'newDir') && editingNode.path === node.path;

  useEffect(() => {
    if (isAddingChild) setExpanded(true);
  }, [isAddingChild]);

  return (
    <div>
      <div 
        className="file-item"
        style={{
          paddingLeft: `${depth * 15 + 10}px`,
          paddingTop: '4px',
          paddingBottom: '4px',
          backgroundColor: activeTab === node.path ? 'var(--accent)' : 'transparent',
          color: activeTab === node.path ? '#fff' : 'var(--text-primary)',
          fontWeight: activeTab === node.path ? 'bold' : 'normal',
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          cursor: 'pointer',
          fontSize: '12px'
        }}
        onClick={() => {
          if (node.isDir) setExpanded(!expanded);
          else onSelect(node.path);
        }}
        onContextMenu={(e) => onContextMenu(e, node.path, node.isDir)}
      >
        <span>{node.isDir ? (expanded ? '📂' : '📁') : '📄'}</span>
        {isRenaming ? (
          <input 
            autoFocus
            className="file-tree-input"
            defaultValue={editingNode.initialValue}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onEditComplete(e.currentTarget.value);
              if (e.key === 'Escape') onEditCancel();
            }}
            onBlur={(e) => onEditComplete(e.target.value)}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.name}</span>
        )}
      </div>
      
      {expanded && isAddingChild && (
        <div style={{ paddingLeft: `${(depth + 1) * 15 + 10}px`, display: 'flex', alignItems: 'center', gap: '5px', marginTop: '2px' }}>
          <span>{editingNode.type === 'newDir' ? '📁' : '📄'}</span>
          <input
            autoFocus
            className="file-tree-input"
            defaultValue=""
            placeholder={editingNode.type === 'newDir' ? 'Folder Name' : 'File Name'}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onEditComplete(e.currentTarget.value);
              if (e.key === 'Escape') onEditCancel();
            }}
            onBlur={(e) => {
              if (e.target.value.trim()) onEditComplete(e.target.value);
              else onEditCancel();
            }}
          />
        </div>
      )}

      {expanded && node.children && node.children.map(child => (
        <FileTreeNode 
          key={child.path} 
          node={child} 
          activeTab={activeTab} 
          onSelect={onSelect} 
          onContextMenu={onContextMenu}
          editingNode={editingNode}
          onEditComplete={onEditComplete}
          onEditCancel={onEditCancel}
          depth={depth + 1} 
        />
      ))}
    </div>
  );
};
