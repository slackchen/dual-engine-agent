import { useState, useRef, useEffect } from 'react';

export function useFileEditor(
  setOpenTabs: (fn: (prev: string[]) => string[]) => void,
  setActiveTab: (tab: string) => void,
) {
  const [activeFileContent, setActiveFileContent] = useState('// Select a file to view code');
  const editorRef = useRef<any>(null);
  const decorationsRef = useRef<any>(null);
  const [highlightRange, setHighlightRange] = useState<{ startLine: number; endLine: number } | null>(null);
  const [diffState, setDiffState] = useState<{ original: string; modified: string; startLine?: number } | null>(null);

  // Listen for agent file-updated events (global: open tab + show diff)
  useEffect(() => {
    // @ts-ignore
    if (typeof window.ipcRenderer !== 'undefined') {
      const handleGlobalFileUpdate = (_event: any, data: any) => {
        if (!data?.filePath) return;
        setOpenTabs(prev => (prev.includes(data.filePath) ? prev : [...prev, data.filePath]));
        setActiveTab(data.filePath);
        if (data.isEdit && data.oldContent && data.newContent) {
          setDiffState({ original: data.oldContent, modified: data.newContent, startLine: data.startLine });
        } else if (data.range) {
          setHighlightRange(data.range);
        }
      };
      // @ts-ignore
      window.ipcRenderer.on('agent:file-updated', handleGlobalFileUpdate);
      return () => {
        // @ts-ignore
        window.ipcRenderer.removeListener('agent:file-updated', handleGlobalFileUpdate);
      };
    }
  }, [setOpenTabs, setActiveTab]);

  // Apply highlight decorations in Monaco when highlightRange changes
  useEffect(() => {
    if (editorRef.current && highlightRange) {
      if (decorationsRef.current) decorationsRef.current.clear();
      decorationsRef.current = editorRef.current.createDecorationsCollection([
        {
          range: {
            startLineNumber: highlightRange.startLine,
            startColumn: 1,
            endLineNumber: highlightRange.endLine,
            endColumn: 1,
          },
          options: {
            isWholeLine: true,
            className: 'agent-edit-highlight',
            marginClassName: 'agent-edit-margin',
          },
        },
      ]);
      editorRef.current.revealLinesInCenter(highlightRange.startLine, highlightRange.endLine);
      const timer = setTimeout(() => {
        if (decorationsRef.current) decorationsRef.current.clear();
        setHighlightRange(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [activeFileContent, highlightRange]);

  return {
    activeFileContent, setActiveFileContent,
    editorRef,
    highlightRange, setHighlightRange,
    diffState, setDiffState,
  };
}
