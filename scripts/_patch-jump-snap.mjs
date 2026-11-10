import fs from 'node:fs'
// 1) floating copy is a sibling of the (transformed) panel → coordinates must be viewport-based
const tsx = 'src/client/StatusRail.tsx'
let text = fs.readFileSync(tsx, 'utf8')
text = text.replace(
  `    const rect = element.getBoundingClientRect()
    // The panel is transformed (it slides in), so a position:fixed child is laid out
    // against the panel, not the viewport: keep panel-relative coordinates.
    const panelRect = panelRef.current?.getBoundingClientRect()
    event.preventDefault()`,
  `    const rect = element.getBoundingClientRect()
    // The floating copy is a direct child of .statusRail (outside the transformed panel),
    // so position:fixed there is viewport-relative — use viewport numbers, not panel ones.
    event.preventDefault()`,
)
text = text.replace(
  `      left: rect.left - (panelRect?.left ?? 0),
      baseTop: rect.top - (panelRect?.top ?? 0),`,
  `      left: rect.left,
      baseTop: rect.top,`,
)
fs.writeFileSync(tsx, text, 'utf8')

// 2) the drawer's scroll-snap fought every wheel tick (slow, then stuck when reversing)
const css = 'src/client/mind-map.module.css'
let sheet = fs.readFileSync(css, 'utf8')
sheet = sheet.replace('  scroll-snap-type: y proximity;\n', '')
sheet = sheet.replace('  scroll-snap-align: start;\n', '')
fs.writeFileSync(css, sheet, 'utf8')
console.log('floating coords = viewport; scroll-snap removed')
