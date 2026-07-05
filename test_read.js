const fs = require('fs');
const content = fs.readFileSync('/Users/adrian/Documents/proj/AI/UnameTest/game.html', 'utf8');
console.log("Length:", content.length);
console.log("Starts with:", content.substring(0, 50));
