const fs = require('fs');
let content = fs.readFileSync('h:/claw/apps/api/src/server.ts', 'utf8');

// ??? U+FFFD ??
const count = (content.match(/\uFFFD/g) || []).length;
console.log('Found', count, 'U+FFFD characters');

content = content.replace(/\uFFFD/g, '');

fs.writeFileSync('h:/claw/apps/api/src/server.ts', content, 'utf8');
console.log('Removed all U+FFFD!');
