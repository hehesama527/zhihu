const fs = require('fs');
let content = fs.readFileSync('h:/claw/apps/api/src/server.ts', 'utf8');
// ????? ASCII ?????????
content = content.replace(/[\uFFFD\uE000-\uF8FF]/g, '');
// ?????????????
content = content.replace(/""/g, '"');
fs.writeFileSync('h:/claw/apps/api/src/server.ts', content, 'utf8');
console.log('Full cleanup done!');
