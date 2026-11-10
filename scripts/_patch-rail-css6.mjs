import fs from 'node:fs'
const file = 'src/client/mind-map.module.css'
let text = fs.readFileSync(file, 'utf8')
text = text.replace('  left: calc(var(--rail-w) - 4px);', '  /* flush against the panel edge: a step here read as a misaligned seam */\n  left: calc(var(--rail-w) - 1px);')
text = text.replace('  box-shadow: 2px 0 10px rgba(0, 0, 0, 0.25);', '  box-shadow: 3px 0 12px rgba(0, 0, 0, 0.28);')
fs.writeFileSync(file, text, 'utf8')
console.log('handle flush with the panel edge')
