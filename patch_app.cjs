const fs = require('fs');
let app = fs.readFileSync('src/App.tsx', 'utf8');

// 1. Add FileNode interface
app = app.replace(
  "export interface Message {",
  "export interface FileNode {\n  name: string;\n  path: string;\n  isDir: boolean;\n  children?: FileNode[];\n}\n\nexport interface Message {"
);

// 2. Add FileTreeNode component
const fileTreeNodeCode = `
const FileTreeNode = ({ node, activeFile, onSelect, depth = 0 }: { node: FileNode, activeFile: string, onSelect: (path: string) => void, depth?: number }) => {
  const [expanded, setExpanded] = React.useState(false);
  return (
    <div>
      <div 
        className="file-item"
        style={{
          paddingLeft: \`\${depth * 15 + 10}px\`,
          paddingTop: '4px',
          paddingBottom: '4px',
          backgroundColor: activeFile === node.path ? 'var(--accent)' : 'transparent',
          fontWeight: activeFile === node.path ? 'bold' : 'normal',
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          cursor: 'pointer',
          color: 'var(--text-primary)',
          fontSize: '12px'
        }}
        onClick={() => {
          if (node.isDir) setExpanded(!expanded);
          else onSelect(node.path);
        }}
      >
        <span>{node.isDir ? (expanded ? '📂' : '📁') : '📄'}</span>
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.name}</span>
      </div>
      {node.isDir && expanded && node.children?.map(child => (
        <FileTreeNode key={child.path} node={child} activeFile={activeFile} onSelect={onSelect} depth={depth + 1} />
      ))}
    </div>
  );
};
`;
app = app.replace(
  "const parseReasoning = (text: string) => {",
  fileTreeNodeCode + "\n\nconst parseReasoning = (text: string) => {"
);

// 3. Change states
app = app.replace(
  "const [fileSystem, setFileSystem] = useState<Record<string, any>>({});",
  "const [fileTree, setFileTree] = useState<FileNode[]>([]);\n  const [activeFileContent, setActiveFileContent] = useState<string>('// Select a file to view code');"
);
app = app.replace(
  "const [fileNodes, setFileNodes] = useState<string[]>([]);",
  ""
);

// 4. Update file refresh logic
app = app.replace(
  /const refreshFiles = async \(\) => {[\s\S]*?};/,
  `const refreshFiles = async () => {
    if (!workspacePath) return;
    try {
      // @ts-ignore
      const tree = await window.ipcRenderer.invoke('agent:get-fs-tree', { workspacePath });
      setFileTree(tree);
    } catch(e) {}
  };`
);

// 5. Replace fs-state listener
app = app.replace(
  `          } else if (data.type === 'fs-state') {
             setFileSystem(data.data);`,
  `          } else if (data.type === 'fs-state') {
             refreshFiles();`
);

// 6. Fix active file effect
const activeFileEffect = `
  useEffect(() => {
    if (!activeFile) return;
    const loadContent = async () => {
      try {
        // @ts-ignore
        const content = await window.ipcRenderer.invoke('agent:read-file', { filePath: activeFile });
        setActiveFileContent(content);
      } catch (e) {
        setActiveFileContent('// Error reading file');
      }
    };
    loadContent();
  }, [activeFile]);
`;
app = app.replace(
  "const handleOpenWorkspace = async () => {",
  activeFileEffect + "\n\n  const handleOpenWorkspace = async () => {"
);

// 7. Render File Tree
app = app.replace(
  /\{fileNodes\.map\(filePath => \{[\s\S]*?\)\}\}/,
  `{fileTree.map(node => (
            <FileTreeNode key={node.path} node={node} activeFile={activeFile} onSelect={setActiveFile} />
          ))}`
);
app = app.replace(
  `{fileNodes.length === 0 && <div className="file-item" style={{color:'var(--text-secondary)'}}>No files yet. Please open a folder.</div>}`,
  `{fileTree.length === 0 && <div className="file-item" style={{color:'var(--text-secondary)', padding: '10px'}}>No files yet. Please open a folder.</div>}`
);

// 8. Update Editor
app = app.replace(
  "value={fileSystem[activeFile] || '// Select a file to view code'}",
  "value={activeFileContent}"
);
app = app.replace(
  "setFileSystem(prev => ({ ...prev, [activeFile]: val || '' }));",
  "setActiveFileContent(val || '');"
);

fs.writeFileSync('src/App.tsx', app);
console.log("Patched App.tsx successfully");
