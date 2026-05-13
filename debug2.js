const fs = require('fs');
const content = fs.readFileSync('h:/claw/apps/api/src/server.ts', 'utf8');
const searchStr = '?????????';
const idx = content.indexOf(searchStr);
console.log('Search string:', searchStr);
console.log('Index:', idx);
if (idx >= 0) {
  console.log('Found at position:', idx);
  console.log('Context:', content.substring(idx - 5, idx + 20));
  for (let i = 0; i < 5; i++) {
    const c = content[idx + searchStr.length + i];
    if (c) {
      console.log('Char ' + i + ': [' + c + '] = U+' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'));
    }
  }
}
