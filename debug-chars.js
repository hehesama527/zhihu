const fs = require('fs');
const content = fs.readFileSync('h:/claw/apps/api/src/server.ts', 'utf8');
const idx = content.indexOf('error instanceof Error');
if (idx >= 0) {
  const startIdx = idx + 'error instanceof Error ? error.message : "'.length;
  const endIdx = content.indexOf('"', startIdx);
  const msg = content.substring(startIdx, endIdx);
  
  console.log('Message:', msg);
  console.log('Length:', msg.length);
  for (let i = 0; i < msg.length; i++) {
    const c = msg[i];
    console.log(i + ': [' + c + '] = U+' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'));
  }
  
  console.log('\\nExpected: ?????????');
  const expected = '?????????';
  for (let i = 0; i < expected.length; i++) {
    const c = expected[i];
    console.log(i + ': [' + c + '] = U+' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'));
  }
}
