const fs = require('fs');
const iconv = require('iconv-lite');

// ??????
const buffer = fs.readFileSync('h:/claw/apps/api/src/server.ts');

// ?? GBK ????
const content = iconv.decode(buffer, 'gbk');

// ????????????
const idx = content.indexOf('?????????');
console.log('Found at:', idx);
if (idx >= 0) {
  console.log('Context:', content.substring(idx, idx + 15));
}

// ??? UTF-8??? BOM?
fs.writeFileSync('h:/claw/apps/api/src/server.ts', content, 'utf8');
console.log('Conversion done!');
