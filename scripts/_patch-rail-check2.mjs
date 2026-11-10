/** Finalise the rail check: synthetic drag, and a lamp-label assertion instead of DOM counting. */
import fs from 'node:fs'

const file = 'scripts/_status-rail-check.mjs'
let text = fs.readFileSync(file, 'utf8')

// Assert every row carries a known lamp label instead of guessing from card DOM.
text = text.replace(
  "  const litCards = [...document.querySelectorAll('[data-mindmap-session]')].filter(element =>\n    element.querySelector('[class*=\"cardLamp\"]') !== null).length",
  "  const LAMPS = ['运行中', '等你回复', '待查看', '异常终止', 'running', 'waiting', 'unread', 'error']\n  const litCards = rows.filter(row => LAMPS.includes(row.lamp)).length",
)

// Replace the playwright dragTo block with a synthetic HTML5 drag (React listens on the row).
const from = text.indexOf('// Drag the second row onto the first')
const to = text.indexOf('const shot = process.argv.includes')
if (from < 0 || to < 0) { console.log('drag block anchors missing'); process.exit(1) }
const block = `// Drag the second row onto the first: the order must flip and be remembered.
const before = (await read()).rows.map(row => row.title)
const dragged = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[class*="statusRailPanel"] [role="listitem"]')]
  if (rows.length < 2) return 0
  const data = new DataTransfer()
  const fire = (element, type) => element.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }))
  fire(rows[1], 'dragstart')
  fire(rows[0], 'dragover')
  fire(rows[0], 'drop')
  fire(rows[1], 'dragend')
  return rows.length
})
await page.waitForTimeout(400)
const after = (await read()).rows.map(row => row.title)
const stored = await page.evaluate(() => window.localStorage.getItem('dsh.mind-map.status-rail.order.v1'))
const dragResult = dragged >= 2
  ? { before: before.slice(0, 3), after: after.slice(0, 3), movedToTop: after[0] === before[1], stored: stored !== null }
  : null

`
text = text.slice(0, from) + block + text.slice(to)

// rowsMatchLit now means "every row has a real lamp label".
text = text.replace(
  '  rowsMatchLit: opened.rows.length === opened.litCards,',
  '  rowsMatchLit: opened.rows.length === opened.litCards && opened.rows.length > 0,',
)
fs.writeFileSync(file, text, 'utf8')
console.log('checker finalised')
