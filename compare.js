const fs = require('fs');
const iconv = require('iconv-lite');

const buffer = fs.readFileSync('h:/claw/apps/api/src/server.ts');

// ?? UTF-8
const utf8Content = iconv.decode(buffer, 'utf8');
const idx1 = utf8Content.indexOf('error instanceof Error');
if (idx1 >= 0) {
  console.log('UTF-8 - Found at:', idx1);
  console.log('Context:', utf8Content.substring(idx1, idx1 + 80));
  console.log('---');
}

// ?? GBK
const gbkContent = iconv.decode(buffer, 'gbk');
const idx2 = gbkContent.indexOf('error instanceof Error');
if (idx2 >= 0) {
  console.log('GBK - Found at:', idx2);
  console.log('Context:', gbkContent.substring(idx2, idx2 + 80));
}
