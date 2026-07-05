const fs = require('fs');

let content = fs.readFileSync('src/App.tsx', 'utf8');

// 1. Update diffState type
content = content.replace(
  "const [diffState, setDiffState] = useState<{original: string, modified: string} | null>(null);",
  "const [diffState, setDiffState] = useState<{original: string, modified: string, startLine?: number} | null>(null);"
);

// 2. Update auto-scroll in chat messages
const scrollOld = `  useEffect(() => {
    const container = document.querySelector('.chat-messages');
    if (!container) return;
    
    // Robust native scrolling on the container itself
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    
    if (!hasLoadedHistory.current && messages.length > 0) {
      hasLoadedHistory.current = true;
      setTimeout(() => {
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      }, 300);
    }
  }, [messages]);`;

const scrollNew = `  useEffect(() => {
    const container = document.querySelector('.chat-messages');
    if (!container) return;
    
    // Check if user is currently near the bottom (within 150px)
    const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 150;
    
    if (isAtBottom) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }
    
    if (!hasLoadedHistory.current && messages.length > 0) {
      hasLoadedHistory.current = true;
      setTimeout(() => {
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      }, 300);
    }
  }, [messages]);`;

content = content.replace(scrollOld, scrollNew);

// 3. Update handleGlobalFileUpdate
const fileUpdateOld = `        if (data.isEdit && data.oldContent && data.newContent) {
          setDiffState({ original: data.oldContent, modified: data.newContent });
          setTimeout(() => setDiffState(null), 5000);
        } else if (data.range) {
          setHighlightRange(data.range);
        }`;

const fileUpdateNew = `        if (data.isEdit && data.oldContent && data.newContent) {
          // Open diff state automatically and don't automatically close it!
          setDiffState({ original: data.oldContent, modified: data.newContent, startLine: data.startLine });
          // Optional: we can remove the 5000ms timeout so the diff stays open for review.
        } else if (data.range) {
          setHighlightRange(data.range);
        }`;

content = content.replace(fileUpdateOld, fileUpdateNew);

// 4. Update DiffEditor to use startLine via onMount
const diffEditorOld = `              <DiffEditor
                height="100%"
                language="javascript"
                theme="vs-dark"
                original={diffState.original}
                modified={diffState.modified}
                options={{
                  readOnly: true,
                  renderSideBySide: true,
                  enableSplitViewResizing: true
                }}
              />`;

const diffEditorNew = `              <DiffEditor
                height="100%"
                language="javascript"
                theme="vs-dark"
                original={diffState.original}
                modified={diffState.modified}
                options={{
                  readOnly: true,
                  renderSideBySide: true,
                  enableSplitViewResizing: true
                }}
                onMount={(editor) => {
                  if (diffState.startLine) {
                    setTimeout(() => {
                      editor.getModifiedEditor().revealLineInCenter(diffState.startLine);
                      editor.getOriginalEditor().revealLineInCenter(diffState.startLine);
                    }, 100);
                  }
                }}
              />`;

content = content.replace(diffEditorOld, diffEditorNew);

fs.writeFileSync('src/App.tsx', content);
console.log("Patched App.tsx with scrolling and diff updates");
