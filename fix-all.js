const fs = require('fs');
const content = fs.readFileSync('h:/claw/apps/api/src/server.ts', 'utf8');

// ???????????????????
const fixed = content.replace(/("[\u4e00-\u9fa5???????""''??????\w\s]+)\uFFFD/g, '');

fs.writeFileSync('h:/claw/apps/api/src/server.ts', fixed, 'utf8');
console.log('Fixed all Chinese strings!');
