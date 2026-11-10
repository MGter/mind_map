import fs from 'node:fs'
const css = 'src/client/mind-map.module.css'
let sheet = fs.readFileSync(css, 'utf8')
if (!sheet.includes('.statusRailGhost')) {
  sheet += String.raw`

/* The picked card keeps its slot (hidden) so the column cannot collapse, while a copy
   follows the pointer — that is what lets the gap open in both directions. */
.statusRailGhost {
  visibility: hidden;
}

.statusRailFloating {
  position: fixed;
  z-index: 20;
  pointer-events: none;
}
`
}
fs.writeFileSync(css, sheet, 'utf8')
console.log('ghost + floating styles')
