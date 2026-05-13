const fs = require('fs');
const content = fs.readFileSync('h:/claw/apps/api/src/server.ts', 'utf8');

// ????? ASCII ??
const badChars = new Set();
for (let i = 0; i < content.length; i++) {
  const c = content[i];
  const code = c.charCodeAt(0);
  if (code > 127 && code < 0x4E00) {  // ????????? ASCII
    badChars.add(c);
  }
}

console.log('Found', badChars.size, 'bad characters:');
for (const c of badChars) {
  console.log('[' + c + ']' + ' = U+' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'));
}
