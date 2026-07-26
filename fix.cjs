const fs = require('fs');
let c = fs.readFileSync('views/home.ejs', 'utf-8');
c = c.replace(/\\\$/g, '$');
c = c.replace(/\\`/g, '`');
c = c.replace(/\\\\n/g, '\\n');
fs.writeFileSync('views/home.ejs', c);
console.log('Fixed home.ejs escapes');
