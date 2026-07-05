import path from 'node:path';
import fs from 'node:fs';

export const resolveSafePath = (workspacePath: string, filePath: string, isCreation: boolean = false) => {
  let cleanPath = filePath;
  if (cleanPath.startsWith(workspacePath)) {
    cleanPath = cleanPath.slice(workspacePath.length);
  }
  cleanPath = cleanPath.replace(/^\/+/, '');
  
  const directPath = path.join(workspacePath, cleanPath);
  
  // If the direct path exists, use it.
  if (fs.existsSync(directPath)) {
    return directPath;
  }
  
  // If the direct path does not exist, and it's just a filename (no slashes),
  // try to find it in the workspace (ONLY if we are not creating a new file).
  if (!isCreation && !cleanPath.includes('/')) {
    const foundPath = searchFileRecursively(workspacePath, cleanPath);
    if (foundPath) {
      return foundPath;
    }
  }
  
  return directPath;
};

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
  } catch (e) {
    // ignore permission errors, etc
  }
  return null;
}
