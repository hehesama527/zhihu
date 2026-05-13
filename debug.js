const fs = require('fs');
const content = fs.readFileSync('h:/claw/apps/api/src/server.ts', 'utf8');
const idx = content.indexOf('"?????????"');
if (idx >= 0) {
  const substring = content.substring(idx + 11, idx + 16);
  console.log('Substring length:', substring.length);
  for (let i = 0; i < substring.length; i++) {
    const c = substring[i];
    console.log('Char ' + i + ': ' + c + ' = U+' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'));
  }
}
