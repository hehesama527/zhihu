const fs = require('fs');
const content = fs.readFileSync('h:/claw/apps/api/src/server.ts', 'utf8');

const idx = content.indexOf('error instanceof Error');
if (idx >= 0) {
  const startIdx = idx + 'error instanceof Error ? error.message : "'.length;
  const endIdx = content.indexOf('"', startIdx);
  const msg = content.substring(startIdx, endIdx);
  
  console.log('Actual message: [' + msg + ']');
  console.log('Length:', msg.length);
  console.log('Last char:', msg[msg.length - 1]);
  console.log('Last char code:', 'U+' + msg.charCodeAt(msg.length - 1).toString(16).toUpperCase().padStart(4, '0'));
  
  // ??????
  const trimmed = msg.replace(/[?]$/, '');
  console.log('\\nTrimmed message: [' + trimmed + ']');
  console.log('Trimmed length:', trimmed.length);
  
  // ??
  if (msg !== trimmed) {
    content = content.split('"' + msg + '"').join('"' + trimmed + '"');
    fs.writeFileSync('h:/claw/apps/api/src/server.ts', content, 'utf8');
    console.log('\\nFixed!');
  }
}
