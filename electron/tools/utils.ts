import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const resolveSafePath = (workspacePath: string, filePath: string, isCreation: boolean = false) => {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('filePath is required.');
  }

  const workspaceRoot = path.resolve(workspacePath);
  let cleanPath = filePath.trim().replace(/^["']|["']$/g, '');

  if (/^file:\/\//i.test(cleanPath)) {
    try {
      cleanPath = fileURLToPath(cleanPath);
    } catch {
      cleanPath = decodeURIComponent(cleanPath.replace(/^file:\/\/\/?/i, ''));
    }
  }

  if (path.isAbsolute(cleanPath)) {
    const absolutePath = path.resolve(cleanPath);
    if (!isInsideWorkspace(workspaceRoot, absolutePath)) {
      throw new Error(`Path is outside workspace: ${filePath}`);
    }
    return absolutePath;
  }

  cleanPath = cleanPath.replace(/^[/\\]+/, '');

  // If the direct path does not exist, and it's just a filename (no slashes),
  // try to find it in the workspace (ONLY if we are not creating a new file).
  if (!isCreation && !cleanPath.includes('/') && !cleanPath.includes('\\')) {
    const foundPath = searchFileRecursively(workspacePath, cleanPath);
    if (foundPath) {
      return foundPath;
    }
  }

  const directPath = path.resolve(workspaceRoot, cleanPath);
  if (!isInsideWorkspace(workspaceRoot, directPath)) {
    throw new Error(`Path is outside workspace: ${filePath}`);
  }

  return directPath;
};

function isInsideWorkspace(workspaceRoot: string, targetPath: string): boolean {
  const relative = path.relative(workspaceRoot, targetPath);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function searchFileRecursively(dir: string, targetName: string): string | null {
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (file === 'node_modules' || file === '.git' || file === 'dist' || file === '.DS_Store') continue;

      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        const found = searchFileRecursively(fullPath, targetName);
        if (found) return found;
      } else if (file === targetName) {
        return fullPath;
      }
    }
  } catch {
    // ignore permission errors, etc
  }
  return null;
}
