const fs = require('fs');
const content = fs.readFileSync('h:/claw/apps/api/src/server.ts', 'utf8');

// ??????
const chineseRegex = /[\u4e00-\u9fa5]+/g;
const matches = content.match(chineseRegex);
if (matches) {
  console.log('Found', matches.length, 'Chinese strings:');
  matches.slice(0, 30).forEach((m, i) => console.log(i + ':', m));
}

// ??????
const idx = content.indexOf('error instanceof Error');
if (idx >= 0) {
  const startIdx = idx + 'error instanceof Error ? error.message : "'.length;
  const endIdx = content.indexOf('"', startIdx);
  const msg = content.substring(startIdx, endIdx);
  console.log('\\nError message:', msg);
}
