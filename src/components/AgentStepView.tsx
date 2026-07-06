import React from 'react';
import { Message } from '../types';
import { ToolCallView } from './ToolCallView';

interface AgentStepViewProps {
  step: any;
  idx: number;
  mergedSteps: any[];
  msg: Message;
  openTabs: string[];
  setOpenTabs: React.Dispatch<React.SetStateAction<string[]>>;
  setActiveTab: React.Dispatch<React.SetStateAction<string>>;
  setDiffState: React.Dispatch<React.SetStateAction<{original: string, modified: string, startLine?: number} | null>>;
}

function getToolFilePath(act: any, res: any): string {
  const args = act?.args ?? {};
  return args.filePath
    || args.path
    || args.targetFile
    || args.AbsolutePath
    || args.file_path
    || args.file
    || args.filename
    || args.htmlFile
    || args.htmlFilePath
    || res?.filePath
    || res?.displayPath
    || '';
}

export function AgentStepView({ step, idx, mergedSteps, msg, openTabs, setOpenTabs, setActiveTab, setDiffState }: AgentStepViewProps) {
  return (
    <div className="agent-step-item" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px', fontSize: '12px' }}>
      {step.thought && (
        <div style={{ marginBottom: '6px', color: '#4EC9B0' }}>
          <span style={{ marginRight: '4px' }}>🤖</span> {step.thought}
        </div>
      )}
      {step.actions && step.actions.map((act: any, actIdx: number) => {
        const res = step.results ? step.results.find((r: any) => r.toolName === act.toolName) : null;
        const isFileMod = act.toolName === 'editFileContent' || act.toolName === 'writeFile' || act.toolName === 'createFile';
        const isCmd = act.toolName === 'runCommand' || act.toolName === 'run_command' || act.toolName === 'executeCommand';
        const isBrowser = act.toolName === 'openBrowser';
        const isReadFile = act.toolName === 'readFile' || act.toolName === 'viewFile';

        return (
          <div key={actIdx} style={{ background: '#252526', borderRadius: '4px', border: '1px solid #3c3c3c', marginTop: '4px', overflow: 'hidden' }}>
            <div style={{ padding: '6px 10px', background: isFileMod ? 'rgba(76, 175, 80, 0.1)' : isCmd ? 'rgba(33, 150, 243, 0.1)' : isReadFile ? 'rgba(255, 152, 0, 0.1)' : '#2d2d2d', borderBottom: '1px solid #3c3c3c', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>
                {isFileMod ? (act.toolName === 'createFile' ? '✨' : '✏️') : isCmd ? '🖥️' : isBrowser ? '🌐' : isReadFile ? '📖' : '🔧'}
              </span>
              <span style={{ color: 'var(--text-primary)', fontWeight: 'bold' }}>
                {(() => {
                  const openFile = (fp: string) => {
                    if (fp && !openTabs.includes(fp)) {
                      setOpenTabs(prev => [...prev, fp]);
                    }
                    if (fp) setActiveTab(fp);
                  };

                  if (isFileMod || isReadFile) {
                    const fullPath = getToolFilePath(act, res);
                    const fileName = (fullPath || 'file').split(/[/\\]/).pop();
                    
                    const fileNameSpan = (
                      <span 
                        style={{ color: '#4fc1ff', cursor: 'pointer', textDecoration: 'underline' }}
                        onClick={() => fullPath && openFile(fullPath)}
                        title={fullPath}
                      >
                        {fileName}
                      </span>
                    );

                    if (isFileMod) {
                      let diffSpan = null;
                      const countLines = (str: any) => typeof str === 'string' && str.length > 0 ? str.split('\n').length : 0;
                      
                      if (act.toolName === 'editFileContent') {
                        const delLines = res?.linesRemoved ?? countLines(act.args?.targetText ?? act.args?.targetContent);
                        const addLines = res?.linesAdded ?? countLines(act.args?.replacementText ?? act.args?.replacementContent);
                        diffSpan = (
                          <span style={{ fontSize: '10px', marginLeft: '8px', fontWeight: 'normal', backgroundColor: 'rgba(0,0,0,0.2)', padding: '2px 6px', borderRadius: '10px' }}>
                            <span style={{ color: '#4CAF50' }}>+{addLines}</span>
                            <span style={{ color: '#888', margin: '0 4px' }}>|</span>
                            <span style={{ color: '#F44336' }}>-{delLines}</span>
                          </span>
                        );
                      } else if ((act.toolName === 'writeFile' || act.toolName === 'createFile') && act.args?.content) {
                        const addLines = res?.linesAdded ?? countLines(act.args?.content);
                        diffSpan = (
                          <span style={{ fontSize: '10px', marginLeft: '8px', fontWeight: 'normal', backgroundColor: 'rgba(0,0,0,0.2)', padding: '2px 6px', borderRadius: '10px' }}>
                            <span style={{ color: '#4CAF50' }}>+{addLines} lines</span>
                          </span>
                        );
                      }
  
                      return <>{act.toolName === 'createFile' ? 'Creating' : 'Editing'} {fileNameSpan}{diffSpan}</>;
                    }
                    if (isReadFile) {
                      return <>Reading {fileNameSpan}</>;
                    }
                  }
                  if (isCmd) {
                    const cmd = act.args?.CommandLine || act.args?.command || '';
                    const lines = cmd.split('\n');
                    let displayCmd = lines[0].trim();
                    if (lines.length > 1 || displayCmd.length > 40) {
                      displayCmd = displayCmd.substring(0, 40) + '...';
                    }
                    return <>Running <span style={{ color: '#DCDCAA', fontFamily: 'monospace' }} title={cmd}>{displayCmd}</span></>;
                  }
                  if (isBrowser) {
                    return 'Opening Browser';
                  }
                  return act.toolName;
                })()}
              </span>
              {res && (
                <span style={{ marginLeft: 'auto', color: res.success ? '#4CAF50' : (msg.isComplete && idx === mergedSteps.length - 1) ? '#F44336' : '#FFC107' }}>
                  {res.success ? '✅' : (msg.isComplete && idx === mergedSteps.length - 1) ? '❌ Failed' : '⚠️ Retrying'}
                </span>
              )}
            </div>
            {step.retryCount > 0 && actIdx === 0 && (() => {
              const stepSuccess = !step.results || step.results.every((r: any) => r.success !== false);
              const isFinalFailure = !stepSuccess && msg.isComplete && idx === mergedSteps.length - 1;
              
              const bgColor = stepSuccess ? 'rgba(76, 175, 80, 0.1)' : isFinalFailure ? 'rgba(244, 67, 54, 0.1)' : 'rgba(255, 193, 7, 0.1)';
              const textColor = stepSuccess ? '#4CAF50' : isFinalFailure ? '#F44336' : '#FFC107';
              const icon = stepSuccess ? '✅' : isFinalFailure ? '❌' : '⚠️';
              const text = stepSuccess 
                ? `Successfully self-corrected after ${step.retryCount} retries!` 
                : isFinalFailure 
                  ? `Failed to self-correct after ${step.retryCount} retries. Agent stopped.` 
                  : `Self-correcting (${step.retryCount} retries)...`;

              return (
                <div style={{ padding: '6px 10px', background: bgColor, color: textColor, fontSize: '11px', borderBottom: '1px solid #3c3c3c' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 'bold' }}>
                    <span style={{ display: 'inline-block', animation: !stepSuccess && !isFinalFailure && idx === mergedSteps.length - 1 ? 'pulse 1.5s infinite' : 'none' }}>
                      {icon}
                    </span>
                    {text}
                  </div>
                  <details style={{ marginTop: '4px' }}>
                    <summary style={{ cursor: 'pointer', opacity: 0.8 }}>View Retry History</summary>
                    <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {step.retryHistory?.map((h: any, hi: number) => {
                        const failedRes = h.results ? h.results.find((r: any) => r.success === false) : null;
                        const failedAct = h.actions ? h.actions.find((a: any) => a.toolName === failedRes?.toolName) : h.actions?.[0];
                        return (
                          <div key={hi} style={{ padding: '6px', background: 'rgba(0,0,0,0.2)', borderRadius: '4px', borderLeft: '2px solid #F44336' }}>
                            <div style={{ color: '#F44336', marginBottom: '4px', fontWeight: 'bold' }}>Attempt #{hi + 1} Failed ({failedAct?.toolName || 'Unknown'}):</div>
                            <div style={{ color: '#ccc', marginBottom: '4px' }}>Args used: <code style={{ background: '#1e1e1e', padding: '2px 4px', borderRadius: '3px' }}>{JSON.stringify(failedAct?.args || {})}</code></div>
                            <div style={{ color: '#FFC107', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{failedRes?.error || failedRes?.message || 'Unknown error'}</div>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                </div>
              );
            })()}
            
            <ToolCallView 
              act={act}
              res={res}
              msg={msg}
              idx={idx}
              mergedSteps={mergedSteps}
              openTabs={openTabs}
              setOpenTabs={setOpenTabs}
              setActiveTab={setActiveTab}
              setDiffState={setDiffState}
            />
          </div>
        );
      })}
    </div>
  );
}
