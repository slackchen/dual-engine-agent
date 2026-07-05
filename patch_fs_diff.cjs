const fs = require('fs');

let content = fs.readFileSync('electron/tools/fs.ts', 'utf8');

const diffFunction = `
function calculateLineDiff(oldBlock: string, newBlock: string) {
  const oldLines = oldBlock.split('\\n');
  const newLines = newBlock.split('\\n');
  let unchangedCount = 0;
  
  // Create a copy we can modify
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
`;

// Insert it at the top of the file
content = content.replace("import * as path from 'path';", "import * as path from 'path';\n" + diffFunction);

// Update exact match
const exactOld = `            return { success: true, message: \`Successfully updated \${filePath}\`, linesAdded: newReplacementLines, linesRemoved: targetContentLines, actualOldContent: actualOldContentBlock, actualNewContent: actualNewContentBlock };`;
const exactNew = `            const diff = calculateLineDiff(actualOldContentBlock, actualNewContentBlock);
            return { success: true, message: \`Successfully updated \${filePath}\`, linesAdded: diff.added, linesRemoved: diff.removed, actualOldContent: actualOldContentBlock, actualNewContent: actualNewContentBlock };`;
content = content.replace(exactOld, exactNew);

// Update fuzzy match
const fuzzyOld = `          return { success: true, message: \`Successfully updated \${filePath}\`, linesAdded: adjustedReplacementLines.length, linesRemoved: removeCount, actualOldContent: actualOldContentBlock, actualNewContent: actualNewContentBlock };`;
const fuzzyNew = `          const diff = calculateLineDiff(actualOldContentBlock, actualNewContentBlock);
          return { success: true, message: \`Successfully updated \${filePath}\`, linesAdded: diff.added, linesRemoved: diff.removed, actualOldContent: actualOldContentBlock, actualNewContent: actualNewContentBlock };`;
content = content.replace(fuzzyOld, fuzzyNew);

// Update multi_replace exact match
const multiExactOld = `              linesAddedTotal += newReplacementLines;
              linesRemovedTotal += targetContentLines;`;
const multiExactNew = `              const diff = calculateLineDiff(actualOldContentBlock, actualNewContentBlock);
              linesAddedTotal += diff.added;
              linesRemovedTotal += diff.removed;`;
content = content.replace(multiExactOld, multiExactNew);

// Update multi_replace fuzzy match
const multiFuzzyOld = `            linesAddedTotal += adjustedReplacementLines.length;
            linesRemovedTotal += removeCount;`;
const multiFuzzyNew = `            const diff = calculateLineDiff(actualOldContentBlock, actualNewContentBlock);
            linesAddedTotal += diff.added;
            linesRemovedTotal += diff.removed;`;
content = content.replace(multiFuzzyOld, multiFuzzyNew);

fs.writeFileSync('electron/tools/fs.ts', content);
console.log("Patched fs.ts with proper diff counts");
