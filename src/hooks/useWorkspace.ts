import { useState, useEffect, useCallback } from 'react';
import { FileNode } from '../types';

export function useWorkspace(showHiddenFiles: boolean) {
  const [workspacePath, setWorkspacePath] = useState('');
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState('');
  const [isStateLoaded, setIsStateLoaded] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string; isDir: boolean } | null>(null);
  const [editingNode, setEditingNode] = useState<{ path: string; type: 'rename' | 'newFile' | 'newDir'; initialValue: string } | null>(null);

  // Close context menu on external clicks
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  // Listen to menu:open-folder / menu:close-folder
  useEffect(() => {
    // @ts-ignore
    if (typeof window.ipcRenderer !== 'undefined') {
      const openFolderListener = (_event: any, path: string) => setWorkspacePath(path);
      const closeFolderListener = () => {
        setWorkspacePath('');
        setFileTree([]);
        setOpenTabs([]);
        setActiveTab('');
      };
      // @ts-ignore
      window.ipcRenderer.on('menu:open-folder', openFolderListener);
      // @ts-ignore
      window.ipcRenderer.on('menu:close-folder', closeFolderListener);
      return () => {
        // @ts-ignore
        window.ipcRenderer.removeListener('menu:open-folder', openFolderListener);
        // @ts-ignore
        window.ipcRenderer.removeListener('menu:close-folder', closeFolderListener);
      };
    }
  }, []);

  const refreshFileTree = useCallback(() => {
    // @ts-ignore
    if (typeof window.ipcRenderer !== 'undefined' && workspacePath) {
      // @ts-ignore
      window.ipcRenderer.invoke('agent:get-fs-tree', { workspacePath, showHiddenFiles })
        .then((tree: any) => setFileTree(tree))
        .catch(console.error);
    }
  }, [workspacePath, showHiddenFiles]);

  useEffect(() => {
    if (workspacePath) refreshFileTree();
  }, [showHiddenFiles, workspacePath, refreshFileTree]);

  // Load workspace state (tabs) from main process
  useEffect(() => {
    if (!workspacePath) { setIsStateLoaded(false); return; }
    const loadState = async () => {
      try {
        // @ts-ignore
        const state = await window.ipcRenderer.invoke('agent:load-workspace-state', { workspacePath });
        if (state) {
          setOpenTabs(state.openTabs || []);
          setActiveTab(state.activeTab || '');
        } else {
          setOpenTabs([]);
          setActiveTab('');
        }
      } catch (e) {}
      setIsStateLoaded(true);
    };
    loadState();
  }, [workspacePath]);

  // Save workspace state
  useEffect(() => {
    if (!workspacePath || !isStateLoaded) return;
    try {
      // @ts-ignore
      window.ipcRenderer.invoke('agent:save-workspace-state', {
        workspacePath,
        state: { openTabs, activeTab }
      });
    } catch (e) {}
  }, [openTabs, activeTab, workspacePath, isStateLoaded]);

  const handleOpenWorkspace = async () => {
    // @ts-ignore
    if (typeof window.ipcRenderer !== 'undefined') {
      // @ts-ignore
      const path = await window.ipcRenderer.invoke('agent:select-workspace');
      if (path) {
        setWorkspacePath(path);
        // @ts-ignore
        const tree = await window.ipcRenderer.invoke('agent:get-fs-tree', { workspacePath: path });
        setFileTree(tree);
      }
    }
  };

  const handleContextMenuAction = (action: 'newFile' | 'newDir' | 'rename' | 'delete' | 'reveal') => {
    if (!contextMenu) return;
    const { path: targetPath, isDir } = contextMenu;
    const sep = targetPath.includes('\\') ? '\\' : '/';
    const parent = isDir ? targetPath : targetPath.substring(0, targetPath.lastIndexOf(sep));
    const basename = targetPath.substring(targetPath.lastIndexOf(sep) + 1);

    if (action === 'newFile' || action === 'newDir') {
      setEditingNode({ path: parent, type: action, initialValue: '' });
    } else if (action === 'rename') {
      setEditingNode({ path: targetPath, type: 'rename', initialValue: basename });
    } else if (action === 'delete') {
      if (window.confirm(`Are you sure you want to delete ${basename}?`)) {
        // @ts-ignore
        window.ipcRenderer.invoke('agent:delete-node', { targetPath }).then(() => {
          refreshFileTree();
          if (activeTab === targetPath) setActiveTab('');
        });
      }
    } else if (action === 'reveal') {
      // @ts-ignore
      window.ipcRenderer.invoke('agent:reveal-in-os', { targetPath });
    }
    setContextMenu(null);
  };

  const handleEditComplete = async (value: string) => {
    if (!editingNode || !value.trim()) { setEditingNode(null); return; }
    const { path: targetPath, type, initialValue } = editingNode;
    const sep = targetPath.includes('\\') ? '\\' : '/';
    try {
      if (type === 'rename' && value !== initialValue) {
        const newPath = targetPath.substring(0, targetPath.lastIndexOf(sep)) + sep + value;
        // @ts-ignore
        await window.ipcRenderer.invoke('agent:rename-node', { oldPath: targetPath, newPath });
      } else if (type === 'newFile') {
        const newPath = targetPath + sep + value;
        // @ts-ignore
        await window.ipcRenderer.invoke('agent:create-file', { targetPath: newPath });
      } else if (type === 'newDir') {
        const newPath = targetPath + sep + value;
        // @ts-ignore
        await window.ipcRenderer.invoke('agent:create-dir', { targetPath: newPath });
      }
    } catch (e) {
      console.error(e);
      alert('Operation failed.');
    }
    setEditingNode(null);
    refreshFileTree();
  };

  return {
    workspacePath, setWorkspacePath,
    fileTree, setFileTree,
    openTabs, setOpenTabs,
    activeTab, setActiveTab,
    contextMenu, setContextMenu,
    editingNode,
    isStateLoaded,
    refreshFileTree,
    handleOpenWorkspace,
    handleContextMenuAction,
    handleEditComplete,
  };
}
