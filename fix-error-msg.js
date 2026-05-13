const fs = require('fs');
let content = fs.readFileSync('h:/claw/apps/api/src/server.ts', 'utf8');

// ????????????
const oldStr = '?????????';
const newStr = '?????????';

if (content.includes(oldStr)) {
  content = content.split(oldStr).join(newStr);
  console.log('Fixed the error message!');
} else {
  console.log('String not found, checking for other bad chars...');
  // ?????????? U+FFFD ?????
  const regex = /"[\u4e00-\u9fa5???????""''??????\w\s]+[^\u4e00-\u9fa5"a-zA-Z0-9???????""''??????\s]/g;
  const matches = content.match(regex);
  if (matches) {
    console.log('Found', matches.length, 'matches:');
    matches.forEach(m => console.log(' ', m));
  }
}

fs.writeFileSync('h:/claw/apps/api/src/server.ts', content, 'utf8');
