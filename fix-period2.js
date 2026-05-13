const fs = require('fs');
const content = fs.readFileSync('h:/claw/apps/api/src/server.ts', 'utf8');

const idx = content.indexOf('error instanceof Error');
if (idx >= 0) {
  const startIdx = idx + 'error instanceof Error ? error.message : "'.length;
  const endIdx = content.indexOf('"', startIdx);
  const msg = content.substring(startIdx, endIdx);
  
  console.log('Actual message: [' + msg + ']');
  console.log('Last char code:', 'U+' + msg.charCodeAt(msg.length - 1).toString(16).toUpperCase().padStart(4, '0'));
  
  // ????????????? U+3002
  if (msg.charCodeAt(msg.length - 1) === 0x3002) {
    const trimmed = msg.substring(0, msg.length - 1);
    console.log('Trimmed message: [' + trimmed + ']');
    
    // ??
    content = content.split('"' + msg + '"').join('"' + trimmed + '"');
    fs.writeFileSync('h:/claw/apps/api/src/server.ts', content, 'utf8');
    console.log('Fixed!');
  }
}
