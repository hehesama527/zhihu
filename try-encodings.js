const fs = require('fs');
const iconv = require('iconv-lite');

const buffer = fs.readFileSync('h:/claw/apps/api/src/server.ts');

// ?? UTF-8 ???????
const utf8Content = iconv.decode(buffer, 'utf8', {stripNonBOM: false});

// ?????????
const idx = utf8Content.indexOf('error instanceof Error');
if (idx >= 0) {
  const context = utf8Content.substring(idx, idx + 100);
  console.log('Context:');
  console.log(context);
}

// ???? CP936????? Windows ????
const cp936Content = iconv.decode(buffer, 'cp936');
const idx2 = cp936Content.indexOf('error instanceof Error');
if (idx2 >= 0) {
  const context2 = cp936Content.substring(idx2, idx2 + 100);
  console.log('\\nCP936 Context:');
  console.log(context2);
}
