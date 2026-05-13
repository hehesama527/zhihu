const fs = require('fs');
const iconv = require('iconv-lite');

const buffer = fs.readFileSync('h:/claw/apps/api/src/server-original.ts');

// ?? GBK
const gbkContent = iconv.decode(buffer, 'gbk');
const idx = gbkContent.indexOf('error instanceof Error');
if (idx >= 0) {
  console.log('GBK - Found at:', idx);
  console.log('Context:', gbkContent.substring(idx, idx + 80));
}

// ?? UTF-8
const utf8Content = iconv.decode(buffer, 'utf8');
const idx2 = utf8Content.indexOf('error instanceof Error');
if (idx2 >= 0) {
  console.log('UTF-8 - Found at:', idx2);
  console.log('Context:', utf8Content.substring(idx2, idx2 + 80));
}
