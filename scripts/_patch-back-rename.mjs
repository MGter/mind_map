import fs from 'node:fs'
// 1) CSS: my classes must not collide with the panel header's .backButton
const css = 'src/client/mind-map.module.css'
let sheet = fs.readFileSync(css, 'utf8')
const start = sheet.indexOf('/* ── sidebar entry: map toggle + "back to this conversation" ─────────────── */')
if (start < 0) { console.log('css block not found'); process.exit(1) }
let block = sheet.slice(start)
block = block.replace(/\.backButton/g, '.backToCurrent').replace(/\.backIcon/g, '.backToCurrentIcon')
sheet = sheet.slice(0, start) + block
fs.writeFileSync(css, sheet, 'utf8')

// 2) component: same rename
const tsx = 'src/client/MapToggleButton.tsx'
let text = fs.readFileSync(tsx, 'utf8')
text = text.replace("styles['backButton']", "styles['backToCurrent']").replace("styles['backIcon']", "styles['backToCurrentIcon']")
fs.writeFileSync(tsx, text, 'utf8')
console.log('renamed to backToCurrent / backToCurrentIcon')
