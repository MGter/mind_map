/** Patch the rail checker: layout widths + panel-relative tab overlap. */
import fs from 'node:fs'

const file = 'scripts/_status-rail-check2.mjs'
let text = fs.readFileSync(file, 'utf8')

text = text.replace(
  "const allCards = opened.rows.length > 0 && opened.rows.every(row => row.width === opened.boardCardWidth && row.chip !== '')",
  [
    "const layoutWidth = await page.evaluate(() => {",
    "  const rail = document.querySelector('[class*=\"statusRailCard\"]')",
    "  const board = document.querySelector('[data-mindmap-session]')",
    "  return { rail: rail === null ? 0 : rail.offsetWidth, board: board === null ? 0 : board.offsetWidth }",
    "})",
    "const allCards = opened.rows.length > 0 && layoutWidth.rail === layoutWidth.board && opened.rows.every(row => row.chip !== '')",
  ].join('\n'),
)

text = text.replace(
  "const tabOverlaps = opened.tabLeft !== null && opened.panelWidth !== null\n  && opened.tabLeft > 0 && opened.tabLeft < opened.panelWidth",
  "const tabOverlaps = opened.tabLeft !== null && opened.panelWidth !== null && opened.panelLeft !== null\n  && opened.tabLeft > opened.panelLeft && opened.tabLeft < opened.panelLeft + opened.panelWidth",
)

text = text.replace(
  "  cardsMatchBoard: allCards,",
  "  cardsMatchBoard: allCards,\n  railLayoutWidth: layoutWidth.rail,\n  boardLayoutWidth: layoutWidth.board,\n  panelLeft: opened.panelLeft,\n  tabLeft: opened.tabLeft,",
)
fs.writeFileSync(file, text, 'utf8')
console.log('checker patched')
