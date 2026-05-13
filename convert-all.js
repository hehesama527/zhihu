const fs = require('fs');
const iconv = require('iconv-lite');

// ??????
const buffer = fs.readFileSync('h:/claw/apps/api/src/server.ts');

// ?? GBK ????
const gbkContent = iconv.decode(buffer, 'gbk');

// ??? UTF-8
fs.writeFileSync('h:/claw/apps/api/src/server.ts', gbkContent, 'utf8');
console.log('Converted all Chinese strings to UTF-8!');
