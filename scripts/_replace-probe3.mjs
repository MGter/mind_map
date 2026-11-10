/** Replace the 11b block: tick a card that lives in a folder WITH a stack cell. */
import fs from 'node:fs'

const probe = 'test/probe.mjs'
const lines = fs.readFileSync(probe, 'utf8').split('\n')
const block = [
  '  // ---- 11b. the stack drawer mirrors the canvas selection ----------------',
  '  // Tick a card in the daily folder (it has a stack cell), then open that',
  '  // folder\'s drawer: the picked row must wear the same brand-coloured border.',
  '  const dailyPickPoint = await cardPoint(\'s2\')',
  '  if (dailyPickPoint !== null) {',
  '    await page.mouse.click(dailyPickPoint.x, dailyPickPoint.y)',
  '    await page.waitForTimeout(400)',
  '  }',
  '  const drawerOpened = await page.evaluate(() => {',
  '    const face = document.querySelector(\'.react-flow__node[data-id="stack-ws-daily"] [class*="stackFace"]\')',
  '    if (face === null) return false',
  '    face.click()',
  '    return true',
  '  })',
  '  let drawerSelection = { total: 0, selected: 0, sessions: [] }',
  '  if (drawerOpened === true) {',
  '    await page.waitForTimeout(450)',
  '    drawerSelection = await page.evaluate(() => {',
  '      const rows = [...document.querySelectorAll(\'[data-stack-card]\')]',
  '      const picked = rows.filter(node => node.className.includes(\'cardSelected\'))',
  '      return {',
  '        total: rows.length,',
  '        selected: picked.length,',
  '        sessions: picked.map(node => node.getAttribute(\'data-mindmap-session\')),',
  '      }',
  '    })',
  '    // Close by clicking the backdrop: Escape would also drop batch mode.',
  '    await page.evaluate(() => {',
  '      const backdrop = document.querySelector(\'[class*="drawerBackdrop"]\')',
  '      if (backdrop !== null) backdrop.click()',
  '    })',
  '    await page.waitForTimeout(300)',
  '  }',
  '  check(\'堆叠抽屉里也显示卡片的选中样式\',',
  '    drawerOpened === true && drawerSelection.sessions.includes(\'s2\'),',
  '    JSON.stringify(drawerSelection))',
  '  // Untick it again so the batch delete below still submits exactly two.',
  '  if (dailyPickPoint !== null) {',
  '    await page.mouse.click(dailyPickPoint.x, dailyPickPoint.y)',
  '    await page.waitForTimeout(350)',
  '  }',
]

const start = lines.findIndex(line => line.includes('// ---- 11b. the stack drawer mirrors the canvas selection'))
if (start < 0) {
  console.error('start not found')
  process.exit(1)
}
let end = start
while (end < lines.length && !lines[end].includes("check('堆叠抽屉里也显示卡片的选中样式',")) end += 1
if (end >= lines.length) {
  console.error('end not found')
  process.exit(1)
}
// the old check spans two lines, plus the closing brace of the else-branch
end += 3
const next = [...lines.slice(0, start), ...block, ...lines.slice(end)]
fs.writeFileSync(probe, next.join('\n'), 'utf8')
console.log(`replaced ${start + 1}..${end}`)
