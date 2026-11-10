import fs from 'node:fs'
const css = 'src/client/mind-map.module.css'
let text = fs.readFileSync(css, 'utf8')
text = text.replace(
  '  --rail-w: calc(var(--rail-card-w) + var(--rail-pad) * 2);',
  '  /* .card is content-box: 224 content + 13px padding each side paints 250 wide. */\n  --rail-card-outer: calc(var(--rail-card-w) + 26px);\n  --rail-w: calc(var(--rail-card-outer) + var(--rail-pad) * 2);',
)
fs.writeFileSync(css, text, 'utf8')
console.log('panel width now fits the painted card')
