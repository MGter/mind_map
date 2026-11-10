import fs from 'node:fs'
// 1) JSX: expose the state as a data attribute (independent of CSS-module key exports)
const tsx = 'src/client/StatusRail.tsx'
let text = fs.readFileSync(tsx, 'utf8')
text = text.replace(
  "      className={`${styles['statusRail']}${open ? ` ${styles['statusRailOpen']}` : ''}`}",
  "      className={styles['statusRail']}\n      data-open={open ? '1' : '0'}",
)
fs.writeFileSync(tsx, text, 'utf8')

// 2) CSS: drive the open state from that attribute
const css = 'src/client/mind-map.module.css'
let sheet = fs.readFileSync(css, 'utf8')
sheet = sheet.replace('.statusRailOpen .statusRailPanel {', '.statusRail[data-open="1"] .statusRailPanel {')
sheet = sheet.replace('.statusRailOpen .statusRailTab {', '.statusRail[data-open="1"] .statusRailTab {')
fs.writeFileSync(css, sheet, 'utf8')
console.log('state now driven by [data-open]')
