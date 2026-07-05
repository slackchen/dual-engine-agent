const fs = require('fs');

const oldContent = `
    function update() {
        if (!game.running) return;
        player.x += player.speed;
    }
`;

const targetContent = `
function update() {
    if (!game.running) return;
    player.x += player.speed;
}
`;

const replacementContent = `
function update() {
    if (!game.running) return;
    player.x += player.speed;
    // New logic
}
`;

const normalizedOld = oldContent.replace(/\r\n/g, '\n');
const normalizedTarget = targetContent.replace(/\r\n/g, '\n');

if (normalizedOld.includes(normalizedTarget)) {
    console.log("Exact match!");
} else {
    const oldLines = normalizedOld.split('\n');
    const targetLines = normalizedTarget.split('\n').filter(l => l.trim() !== '' || l !== '');
    
    let matchIndex = -1;
    let matchCount = 0;
    
    for (let i = 0; i <= oldLines.length - targetLines.length; i++) {
        let isMatch = true;
        for (let j = 0; j < targetLines.length; j++) {
            if (oldLines[i + j].trim() !== targetLines[j].trim()) {
                isMatch = false;
                break;
            }
        }
        if (isMatch) {
            matchIndex = i;
            matchCount++;
        }
    }
    console.log("Fuzzy match count:", matchCount);
}
