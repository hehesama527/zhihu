const fs = require('fs');

let content = fs.readFileSync('h:/claw/apps/api/src/server.ts', 'utf8');

// ?? Unicode ???????????
const wrong = '\u93C8\u5D85\u59DF\u7ED4\uE21A\u5F42\u9422\u71B8\u6E6D\u942D\u30E9\u654A\u7487\uE218\u20AC\uFFFD';
const correct = '?????????';

console.log('Wrong string length:', wrong.length);
console.log('Found in content:', content.includes(wrong));

if (content.includes(wrong)) {
  content = content.split(wrong).join(correct);
  fs.writeFileSync('h:/claw/apps/api/src/server.ts', content, 'utf8');
  console.log('Successfully fixed the error message!');
} else {
  console.log('Still not found. Let me check the actual bytes again...');
  const idx = content.indexOf('error instanceof Error');
  if (idx >= 0) {
    const startIdx = idx + 'error instanceof Error ? error.message : "'.length;
    const endIdx = content.indexOf('"', startIdx);
    const actual = content.substring(startIdx, endIdx);
    console.log('Actual string:', actual);
    console.log('Actual string length:', actual.length);
    console.log('Built string:', wrong);
    console.log('Are they equal?', actual === wrong);
  }
}
