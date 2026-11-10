import fs from 'node:fs'
const css = 'src/client/mind-map.module.css'
let sheet = fs.readFileSync(css, 'utf8')
sheet = sheet.replace('  scroll-snap-type: y proximity;', '')
sheet = sheet.replace('  scroll-snap-align: start;', '')
fs.writeFileSync(css, sheet, 'utf8')
console.log('snap lines now:', (sheet.match(/scroll-snap/g) ?? []).length)
