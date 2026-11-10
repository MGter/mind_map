import fs from 'node:fs'
const file = 'src/client/mind-map.module.css'
let text = fs.readFileSync(file, 'utf8')
text = text.replace(
  '  --rail-w: calc(var(--rail-card-outer) + var(--rail-pad) * 2);',
  '  /* +2px: the card\'s own 1px border on each side must not be clipped */\n  --rail-w: calc(var(--rail-card-outer) + var(--rail-pad) * 2 + 2px);',
)
fs.writeFileSync(file, text, 'utf8')
console.log('panel +2px')
