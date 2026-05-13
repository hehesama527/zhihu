const fs = require('fs');
const content = fs.readFileSync('h:/claw/apps/api/src/server.ts', 'utf8');

const idx = content.indexOf('error instanceof Error');
if (idx >= 0) {
  const startIdx = idx + 'error instanceof Error ? error.message : "'.length;
  const endIdx = content.indexOf('"', startIdx);
  const actual = content.substring(startIdx, endIdx);
  
  console.log('Actual string length:', actual.length);
  console.log('Unicode code points:');
  for (let i = 0; i < actual.length; i++) {
    const c = actual[i];
    console.log(i + ': U+' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'));
  }
  
  // ???????
  let wrongStr = '';
  for (let i = 0; i < actual.length; i++) {
    wrongStr += '\\u' + actual.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
  }
  console.log('\\nBuilt wrong string:', wrongStr);
}
