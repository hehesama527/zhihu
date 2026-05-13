const fs = require('fs');
const content = fs.readFileSync('h:/claw/apps/api/src/server.ts', 'utf8');
const idx = content.indexOf('?????????');
if (idx >= 0) {
  const nextChar = content[idx + 10];
  console.log('Next char:', nextChar);
  console.log('Code:', 'U+' + nextChar.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'));
}
