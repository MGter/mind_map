/** Replace the 11b drawer-selection check with a loop over every stack cell. */
import fs from 'node:fs'

const probe = 'test/probe.mjs'
const lines = fs.readFileSync(probe, 'utf8').split('\n')
const block = [
  '  // ---- 11b. the stack drawer mirrors the canvas selection ----------------',
  '  // Whichever folder holds a picked card: open its drawer and look for the',
  '  // brand-coloured row the grid shows for the same card.',
  '  const drawerSelection = { opened: 0, selected: 0, sessions: [] }',
  '  const stackCellIds = await page.evaluate(() => [...document.querySelectorAll(\'.react-flow__node\')]',
  '    .map(node => node.getAttribute(\'data-id\'))',
  '    .filter(id => id !== null && id.startsWith(\'stack-\')))',
  '  for (const cellId of stackCellIds) {',
  '    const opened = await page.evaluate((id) => {',
  '      const face = document.querySelector(`.react-flow__node[data-id="${id}"] [class*="stackFace"]`)',
  '      if (face === null) return false',
  '      face.click()',
  '      return true',
  '    }, cellId)',
  '    if (opened !== true) continue',
  '    await page.waitForTimeout(400)',
  '    const found = await page.evaluate(() => {',
  '      const rows = [...document.querySelectorAll(\'[data-stack-card]\')]',
  '      const picked = rows.filter(node => node.className.includes(\'cardSelected\'))',
  '      return { total: rows.length, selected: picked.length, sessions: picked.map(node => node.getAttribute(\'data-mindmap-session\')) }',
  '    })',
  '    drawerSelection.opened += 1',
  '    drawerSelection.selected += found.selected',
  '    drawerSelection.sessions.push(...found.sessions)',
  '    // Close by clicking the backdrop: Escape would also drop batch mode.',
  '    await page.evaluate(() => {',
  '      const backdrop = document.querySelector(\'[class*="drawerBackdrop"]\')',
  '      if (backdrop !== null) backdrop.click()',
  '    })',
  '    await page.waitForTimeout(250)',
  '    if (drawerSelection.selected > 0) break',
  '  }',
  '  check(\'堆叠抽屉里也显示卡片的选中样式\',',
  '    drawerSelection.selected >= 1, JSON.stringify(drawerSelection))',
]

const start = lines.findIndex(line => line.includes('// ---- 11b. the stack drawer mirrors the canvas selection'))
if (start < 0) {
  console.error('start not found')
  process.exit(1)
}
let end = start
while (end < lines.length && !lines[end].includes("check('堆叠抽屉里也显示卡片的选中样式', false, '没有 daily 的堆叠格子')")) end += 1
if (end >= lines.length) {
  console.error('end not found')
  process.exit(1)
}
// swallow the closing brace of the old else-branch
end += 2
const next = [...lines.slice(0, start), ...block, ...lines.slice(end)]
fs.writeFileSync(probe, next.join('\n'), 'utf8')
console.log(`replaced ${start + 1}..${end}`)
