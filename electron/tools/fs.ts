import { tool } from 'ai';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { resolveSafePath } from './utils';

function calculateLineDiff(oldBlock: string, newBlock: string) {
  const oldLines = oldBlock.split('\n');
  const newLines = newBlock.split('\n');
  let unchangedCount = 0;
  
  const newLinesPool = [...newLines];
  
  for (let i = 0; i < oldLines.length; i++) {
    const matchIdx = newLinesPool.indexOf(oldLines[i]);
    if (matchIdx !== -1) {
      unchangedCount++;
      newLinesPool.splice(matchIdx, 1);
    }
  }
  
  return {
    removed: oldLines.length - unchangedCount,
    added: newLines.length - unchangedCount
  };
}

export function createFSTools(
  workspacePath: string,
  onLog: (log: string) => void,
  onFileUpdated: (filePath: string, payload?: { startLine?: number; endLine?: number; oldContent?: string; newContent?: string; isEdit?: boolean }) => void
) {
  return {
    readFile: tool({
      description: 'Read the contents of a file',
      parameters: z.object({
        filePath: z.string().describe('Relative path to the file in the workspace')
      }),
      // @ts-ignore
      execute: async (input: any) => {
        let { filePath, path } = input ?? {};
        filePath = filePath ?? path;
        try {
          if (typeof filePath !== 'string' || !filePath) return { success: false, error: 'filePath is required.' };
          const fullPath = resolveSafePath(workspacePath, filePath);
          const content = fs.readFileSync(fullPath, 'utf8');
          onLog(`\n> 📖 Read file: ${filePath}\n`);
          return { success: true, content };
        } catch (e: any) {
          return { success: false, error: e.message };
        }
      }
    }),
    writeFile: tool({
      description: 'Write or overwrite a file',
      parameters: z.object({
        filePath: z.string().optional().describe('Relative path to the file in the workspace'),
        content: z.string().optional().describe('File content to write')
      }),
      // @ts-ignore
      execute: async (input: any) => {
        const { filePath, content } = input ?? {};
        try {
          if (typeof filePath !== 'string' || !filePath) return { success: false, error: 'filePath is required.' };
          if (typeof content !== 'string') return { success: false, error: 'content is required and must be a string.' };
          const fullPath = resolveSafePath(workspacePath, filePath);
          
          let oldLinesCount = 0;
          let oldContentStr = '';
          if (fs.existsSync(fullPath)) {
            oldContentStr = fs.readFileSync(fullPath, 'utf8');
            oldLinesCount = oldContentStr ? oldContentStr.split('\n').length : 0;
          }
          
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, content, 'utf8');
          onLog(`\n> 📝 Wrote file: ${filePath}\n`);
          const numLines = content ? content.split('\n').length : 0;
          onFileUpdated(fullPath, { startLine: 1, endLine: numLines, oldContent: '', newContent: content, isEdit: false });
          return { success: true, message: `File ${filePath} written.`, linesAdded: numLines, linesRemoved: oldLinesCount, actualOldContent: oldContentStr, actualNewContent: content };
        } catch (e: any) {
          return { success: false, error: e.message };
        }
      }
    }),
    createFile: tool({
      description: 'Create a new file with the given content',
      parameters: z.object({
        filePath: z.string().optional().describe('Relative path to the new file in the workspace'),
        content: z.string().optional().describe('File content to create')
      }),
      // @ts-ignore
      execute: async (input: any) => {
        const { filePath, content } = input ?? {};
        try {
          if (typeof filePath !== 'string' || !filePath) return { success: false, error: 'filePath is required.' };
          if (typeof content !== 'string') return { success: false, error: 'content is required and must be a string.' };
          const fullPath = resolveSafePath(workspacePath, filePath);
          if (fs.existsSync(fullPath)) return { success: false, error: `File already exists: ${filePath}. Use editFileContent or writeFile to modify it.` };
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, content, 'utf8');
          onLog(`\n> ✨ Created file: ${filePath}\n`);
          const numLines = content ? content.split('\n').length : 0;
          onFileUpdated(fullPath, { startLine: 1, endLine: numLines, oldContent: '', newContent: content, isEdit: false });
          return { success: true, message: `File ${filePath} created.`, linesAdded: numLines, linesRemoved: 0, actualOldContent: '', actualNewContent: content };
        } catch (e: any) {
          return { success: false, error: e.message };
        }
      }
    }),
    editFileContent: tool({
      description: 'Modify specific lines in an existing file using precise target content replacement. Use this to patch code instead of rewriting the whole file.',
      parameters: z.object({
        filePath: z.string().optional().describe('Relative path to the file to edit'),
        targetContent: z.string().optional().describe('The EXACT existing content to be replaced. NEVER use "..." to omit lines. Must be the exact text.'),
        replacementContent: z.string().optional().describe('The new content to insert in place of the targetContent'),
        // Aliases to handle common LLM parameter hallucinations
        oldContent: z.string().optional(),
        target_content: z.string().optional(),
        newContent: z.string().optional(),
        replacement_content: z.string().optional()
      }),
      // @ts-ignore
      execute: async (input: any) => {
        const filePath = input?.filePath;
        const targetContent = input?.targetContent ?? input?.oldContent ?? input?.target_content;
        const replacementContent = input?.replacementContent ?? input?.newContent ?? input?.replacement_content;
        
        try {
          if (typeof filePath !== 'string' || !filePath) {
            return { success: false, error: 'filePath is required and must be a string.' };
          }
          if (typeof targetContent !== 'string') {
            return { success: false, error: 'targetContent is required and must be a string.' };
          }
          if (typeof replacementContent !== 'string') {
            return { success: false, error: 'replacementContent is required and must be a string.' };
          }

          const fullPath = resolveSafePath(workspacePath, filePath);
          if (!fs.existsSync(fullPath)) return { success: false, error: `File not found: ${filePath}` };
          
          const oldContent = fs.readFileSync(fullPath, 'utf8');
          const normalizedOld = oldContent.replace(/\r\n/g, '\n');
          const normalizedTarget = targetContent.replace(/\r\n/g, '\n');

          if (normalizedOld.includes(normalizedTarget)) {
            if (normalizedOld.split(normalizedTarget).length > 2) {
              return { success: false, error: `Target content is not unique (appears multiple times). Please provide a larger block of code.` };
            }
            
            // Calculate exact match line range
            const preMatch = normalizedOld.substring(0, normalizedOld.indexOf(normalizedTarget));
            const startLine = preMatch.split('\n').length;
                                    const endLine = startLine + newReplacementLines - 1;
            
            const newContent = normalizedOld.replace(normalizedTarget, replacementContent.replace(/\r\n/g, '\n'));
            fs.writeFileSync(fullPath, newContent, 'utf8');
            onLog(`\n> ✂️ Edited file: ${filePath} (Exact match)\n`);
            onFileUpdated(fullPath, { startLine, endLine, oldContent, newContent, isEdit: true });
            const actualOldContentBlock = normalizedTarget;
            const actualNewContentBlock = replacementContent.replace(/\r\n/g, '\n');
            const diff = calculateLineDiff(actualOldContentBlock, actualNewContentBlock);
            return { success: true, message: `Successfully updated ${filePath}`, linesAdded: diff.added, linesRemoved: diff.removed, actualOldContent: actualOldContentBlock, actualNewContent: actualNewContentBlock };
          }

          // Fallback: Fuzzy matcher (ignores indentation AND empty lines)
          const oldLines = normalizedOld.split('\n');
          const targetLines = normalizedTarget.split('\n');
          
          // Map non-empty lines with their original indices
          const oldNonEmpty = oldLines.map((text, index) => ({ text: text.trim(), index })).filter(item => item.text !== '');
          const targetNonEmpty = targetLines.map(text => text.trim()).filter(text => text !== '');
          
          let matchStartIndex = -1;
          let matchEndIndex = -1;
          let matchCount = 0;
          
          for (let i = 0; i <= oldNonEmpty.length - targetNonEmpty.length; i++) {
            let isMatch = true;
            for (let j = 0; j < targetNonEmpty.length; j++) {
              if (oldNonEmpty[i + j].text !== targetNonEmpty[j]) {
                isMatch = false;
                break;
              }
            }
            if (isMatch) {
              matchStartIndex = oldNonEmpty[i].index;
              matchEndIndex = oldNonEmpty[i + targetNonEmpty.length - 1].index;
              matchCount++;
            }
          }
          
          if (matchCount === 0) {
            return { success: false, error: `Target content not found in file. Even after ignoring indentation and empty lines, no match was found.` };
          }
          if (matchCount > 1) {
            return { success: false, error: `Target content is not unique. Multiple fuzzy matches found.` };
          }

          const originalIndentMatch = oldLines[matchStartIndex].match(/^\s*/);
          const originalIndent = originalIndentMatch ? originalIndentMatch[0] : '';
          
          const targetIndentMatch = targetLines.find(l => l.trim() !== '')?.match(/^\s*/) || [''];
          const targetIndent = targetIndentMatch[0];
          
          const replacementLines = replacementContent.replace(/\r\n/g, '\n').split('\n');
          const adjustedReplacementLines = replacementLines.map(line => {
            if (line.startsWith(targetIndent)) {
               return originalIndent + line.slice(targetIndent.length);
            }
            return line;
          });
          
          // Splice the matched block out of oldLines and insert adjustedReplacementLines
          const removeCount = matchEndIndex - matchStartIndex + 1;
          const actualOldContentBlock = oldLines.slice(matchStartIndex, matchEndIndex + 1).join('\n');
          const actualNewContentBlock = adjustedReplacementLines.join('\n');
          oldLines.splice(matchStartIndex, removeCount, ...adjustedReplacementLines);
          
          const newContent = oldLines.join('\n');
          fs.writeFileSync(fullPath, newContent, 'utf8');
          onLog(`\n> ✂️ Edited file: ${filePath} (Fuzzy match applied)\n`);
          onFileUpdated(fullPath, { startLine: matchStartIndex + 1, endLine: matchStartIndex + adjustedReplacementLines.length, oldContent, newContent, isEdit: true });
          const diff = calculateLineDiff(actualOldContentBlock, actualNewContentBlock);
          return { success: true, message: `Successfully updated ${filePath}`, linesAdded: diff.added, linesRemoved: diff.removed, actualOldContent: actualOldContentBlock, actualNewContent: actualNewContentBlock };
        } catch (e: any) {
          return { success: false, error: e.message };
        }
      }
    })
  };
}
