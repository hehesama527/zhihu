const fs = require('fs');
const iconv = require('iconv-lite');

const buffer = fs.readFileSync('h:/claw/apps/api/src/server.ts');

// ?? GBK ??
const gbkContent = iconv.decode(buffer, 'gbk');

// ?????????
const chineseRegex = /[\u4e00-\u9fa5]+/g;
const matches = gbkContent.match(chineseRegex);
if (matches) {
  console.log('Found', matches.length, 'Chinese strings:');
  matches.slice(0, 20).forEach((m, i) => console.log(i + ':', m));
}

// ??? UTF-8
fs.writeFileSync('h:/claw/apps/api/src/server.ts', gbkContent, 'utf8');
console.log('\\nConversion complete!');
