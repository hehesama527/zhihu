const fs = require('fs');

// ????
let content = fs.readFileSync('h:/claw/apps/api/src/server.ts', 'utf8');

// ????????????????
const replacements = [
  // ????
  ['\u93C8\u5D85\u59DF\u7ED4\uE21A\u5F42\u9422\u71B8\u6E6D\u942D\u30E9\u654A\u7487\uE218\u20AC\uFFFD', '?????????'],
];

let count = 0;
replacements.forEach(([wrong, correct]) => {
  const regex = new RegExp(wrong, 'g');
  const matches = content.match(regex);
  if (matches) {
    count += matches.length;
    content = content.replace(regex, correct);
  }
});

console.log('Replaced', count, 'occurrences');

// ??
fs.writeFileSync('h:/claw/apps/api/src/server.ts', content, 'utf8');
console.log('Done!');
