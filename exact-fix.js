const fs = require('fs');

let content = fs.readFileSync('h:/claw/apps/api/src/server.ts', 'utf8');

// ??????????
const wrong = '???????????????';
const correct = '?????????';

console.log('Looking for:', wrong);
console.log('Found:', content.includes(wrong));

if (content.includes(wrong)) {
  content = content.split(wrong).join(correct);
  fs.writeFileSync('h:/claw/apps/api/src/server.ts', content, 'utf8');
  console.log('Fixed!');
} else {
  console.log('Not found, trying to find similar strings...');
  // ????? "error instanceof Error ? error.message : " ??????
  const regex = /error instanceof Error \? error\.message : "([^"]+)"/g;
  const match = regex.exec(content);
  if (match) {
    console.log('Found error message:', match[1]);
    console.log('Length:', match[1].length);
    for (let i = 0; i < match[1].length; i++) {
      const c = match[1][i];
      console.log(i + ': [' + c + '] = U+' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'));
    }
  }
}
