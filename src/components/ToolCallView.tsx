import React from 'react';
import { Message } from '../types';

interface ToolCallViewProps {
  act: any;
  res: any;
  msg: Message;
  idx: number;
  mergedSteps: any[];
  openTabs: string[];
  setOpenTabs: React.Dispatch<React.SetStateAction<string[]>>;
  setActiveTab: React.Dispatch<React.SetStateAction<string>>;
  setDiffState: React.Dispatch<React.SetStateAction<{original: string, modified: string, startLine?: number} | null>>;
}

function getToolFilePath(act: any, res: any): string {
  const args = act?.args ?? {};
  return res?.filePath
    || args.AbsolutePath
    || res?.displayPath
    || args.filePath
    || args.path
    || args.targetFile
    || args.file_path
    || args.file
    || args.filename
    || args.htmlFile
    || args.htmlFilePath
    || '';
}

function normalizeNewlines(value: string) {
  return value.replace(/\r\n/g, '\n');
}

function splitSnippet(value: string) {
  return value === '' ? [] : normalizeNewlines(value).split('\n');
}

function linesMatch(lines: string[], startIndex: number, expectedLines: string[]) {
  if (startIndex < 0 || startIndex + expectedLines.length > lines.length) return false;
  for (let i = 0; i < expectedLines.length; i++) {
    if (lines[startIndex + i] !== expectedLines[i]) return false;
  }
  return true;
}

function buildFullFileDiff(currentContent: string, res: any, act: any) {
  const oldSnippet = String(res?.actualOldContent ?? act.args?.targetContent ?? '');
  const newSnippet = String(res?.actualNewContent ?? act.args?.replacementContent ?? act.args?.content ?? '');
  const current = normalizeNewlines(currentContent);
  const normalizedOldSnippet = normalizeNewlines(oldSnippet);
  const normalizedNewSnippet = normalizeNewlines(newSnippet);

  if (!res?.startLine || (!normalizedOldSnippet && !normalizedNewSnippet)) {
    return { original: normalizedOldSnippet, modified: normalizedNewSnippet };
  }

  const currentLines = current.split('\n');
  const newLines = splitSnippet(normalizedNewSnippet);
  const oldLines = splitSnippet(normalizedOldSnippet);
  const startIndex = Math.max(0, Number(res.startLine) - 1);

  if (linesMatch(currentLines, startIndex, newLines)) {
    const originalLines = [...currentLines];
    originalLines.splice(startIndex, newLines.length, ...oldLines);
    return { original: originalLines.join('\n'), modified: current };
  }

  if (normalizedNewSnippet) {
    const matchIndex = current.indexOf(normalizedNewSnippet);
    if (matchIndex !== -1 && current.indexOf(normalizedNewSnippet, matchIndex + normalizedNewSnippet.length) === -1) {
      return {
        original: current.slice(0, matchIndex) + normalizedOldSnippet + current.slice(matchIndex + normalizedNewSnippet.length),
        modified: current,
      };
    }
  }

  return { original: normalizedOldSnippet, modified: normalizedNewSnippet };
}

export function ToolCallView({ act, res, msg, idx, mergedSteps, openTabs, setOpenTabs, setActiveTab, setDiffState }: ToolCallViewProps) {
  const isCmd = act.toolName === 'runCommand' || act.toolName === 'run_command' || act.toolName === 'executeCommand';
  const isFileMod = act.toolName === 'editFileContent' || act.toolName === 'writeFile' || act.toolName === 'createFile' || act.toolName === 'multi_replace_file_content' || act.toolName === 'replace_file_content';
  const hasArgs = act.args && Object.keys(act.args).length > 0;

  return (
    <div style={{ padding: '8px', color: '#ccc' }}>
      {!hasArgs ? (
        // No args: show minimal useful info from the result if available
        <>
          {res && !res.success && (
            <div style={{ marginTop: '4px', background: (msg.isComplete && idx === mergedSteps.length - 1) ? 'rgba(244, 67, 54, 0.1)' : 'rgba(255, 193, 7, 0.1)', padding: '6px', borderRadius: '4px', fontSize: '11px', color: (msg.isComplete && idx === mergedSteps.length - 1) ? '#F44336' : '#FFC107' }}>
              {(msg.isComplete && idx === mergedSteps.length - 1) ? (res.error || res.message) : `Self-correcting: ${res.error || res.message}`}
            </div>
          )}
          {(!res || res.success) && (
            <div style={{ fontSize: '11px', color: '#666', fontStyle: 'italic' }}>
              {isFileMod ? (res?.linesAdded !== undefined ? `+${res.linesAdded} / -${res.linesRemoved} lines` : 'Edit applied.') : isCmd ? 'Command executed.' : 'Done.'}
            </div>
          )}
        </>
      ) : (
        <>
          {isCmd && (
            <details>
              <summary style={{ cursor: 'pointer', fontSize: '11px', color: 'var(--text-secondary)' }}>View Command Details</summary>
              <pre style={{ marginTop: '6px', background: '#1e1e1e', padding: '6px', borderRadius: '4px', overflowX: 'auto', fontSize: '11px', color: '#4CAF50' }}>
                $ {act.args?.CommandLine || act.args?.command || ''}
              </pre>
            </details>
          )}
          {isFileMod && (!res || res.success) && (
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
              {res && res.linesAdded !== undefined ? (
                <span 
                  style={{ cursor: 'pointer', color: 'var(--accent)', textDecoration: 'underline' }}
                  onClick={async () => {
                    const tabName = getToolFilePath(act, res);
                    if (tabName && !openTabs.includes(tabName)) {
                      setOpenTabs(prev => [...prev, tabName]);
                    }
                    if (tabName) setActiveTab(tabName);

                    try {
                      // @ts-ignore
                      const currentContent = tabName && typeof window.ipcRenderer !== 'undefined'
                        // @ts-ignore
                        ? await window.ipcRenderer.invoke('agent:read-file', { filePath: tabName })
                        : '';
                      const diff = buildFullFileDiff(String(currentContent || ''), res, act);
                      setDiffState({ original: diff.original, modified: diff.modified, startLine: res?.startLine });
                    } catch {
                      const orig = res?.actualOldContent ?? act.args.targetContent ?? '';
                      const mod = res?.actualNewContent ?? act.args.replacementContent ?? act.args.content ?? '';
                      setDiffState({ original: orig, modified: mod, startLine: res?.startLine });
                    }
                  }}
                >
                  ✏️ View Edit (+{res.linesAdded} / -{res.linesRemoved} lines)
                </span>
              ) : (
                act.toolName === 'writeFile' ? 'Overwrote file.' : 
                act.toolName === 'createFile' ? 'Created new file.' : 
                'Incremental edit applied.'
              )}
            </div>
          )}
          {!isCmd && (
            <details>
              <summary style={{ cursor: 'pointer', fontSize: '11px', color: 'var(--text-secondary)' }}>View Details</summary>
              <pre style={{ marginTop: '6px', background: '#1e1e1e', padding: '4px', borderRadius: '4px', overflowX: 'auto', fontSize: '11px' }}>
                {JSON.stringify(act.args, null, 2)}
              </pre>
            </details>
          )}
        </>
      )}
      {res && !res.success && (
        <div style={{ marginTop: '4px', background: (msg.isComplete && idx === mergedSteps.length - 1) ? 'rgba(244, 67, 54, 0.1)' : 'rgba(255, 193, 7, 0.1)', padding: '6px', borderRadius: '4px', fontSize: '11px', color: (msg.isComplete && idx === mergedSteps.length - 1) ? '#F44336' : '#FFC107' }}>
          <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
            {(msg.isComplete && idx === mergedSteps.length - 1) ? '❌ Failed' : '⚠️ Retrying...'}
          </div>
          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', opacity: 0.9 }}>
            {res.error || res.message}
          </div>
        </div>
      )}
    </div>
  );
}
