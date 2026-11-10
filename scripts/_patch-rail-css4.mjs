import fs from 'node:fs'
const file = 'src/client/mind-map.module.css'
let text = fs.readFileSync(file, 'utf8')

// 1) list: no horizontal padding → the 250px card fits exactly inside the 270px panel
text = text.replace(
  '  gap: 10px;\n  padding: 2px 2px 14px;\n}',
  '  gap: 10px;\n  padding: 2px 0 14px;\n}',
)

// 2) handle: bigger, and its flat edge sits just on the panel edge (no cross-seam)
text = text.replace(
  `  padding: 9px 5px;
  border: 1px solid var(--dsw-alias-border-secondary);
  border-left: none;
  border-radius: 0 9px 9px 0;`,
  `  min-width: 30px;
  padding: 13px 7px;
  border: 1px solid var(--dsw-alias-border-secondary);
  border-left: none;
  border-radius: 0 11px 11px 0;
  box-shadow: 2px 0 10px rgba(0, 0, 0, 0.25);`,
)

// 3) open position: overlap the panel by 4px only
text = text.replace(
  '  left: calc(var(--rail-w) - 12px);',
  '  left: calc(var(--rail-w) - 4px);',
)

// 4) gap between icon and badge a touch larger for the bigger handle
text = text.replace('  align-items: center;\n  gap: 5px;\n  padding: 13px 7px;', '  align-items: center;\n  gap: 6px;\n  padding: 13px 7px;')

fs.writeFileSync(file, text, 'utf8')
console.log('rail css tuned')
