const fs = require('fs');
const content = fs.readFileSync('h:/claw/apps/api/src/server.ts', 'utf8');
// ?? error instanceof Error ???
const idx = content.indexOf('error instanceof Error');
console.log('Found at:', idx);
if (idx >= 0) {
  const context = content.substring(idx, idx + 100);
  console.log('Context:', context);
  console.log('Context length:', context.length);
  for (let i = 0; i < context.length; i++) {
    const c = context[i];
    const code = c.charCodeAt(0);
    if (code > 127) {
      console.log('Non-ASCII at ' + i + ': [' + c + '] = U+' + code.toString(16).toUpperCase().padStart(4, '0'));
    }
  }
}
