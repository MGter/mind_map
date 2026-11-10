/**
 * Probe: the drawer must (a) show the folder's connections on each card and
 * (b) let a drag change the order and keep it.
 */
import fs from 'node:fs'

const file = 'test/probe.mjs'
const lines = fs.readFileSync(file, 'utf8').split('\n')
const at = lines.findIndex(line => line.includes("check('抽屉里的内容也没丢'"))
if (at < 0) {
  console.error('anchor missing')
  process.exit(1)
}
let end = at
while (end < lines.length && !lines[end].trim().startsWith('String(drawerBefore.rows)')) end += 1

const block = [
  '  // Connections between cards of this folder are spelled out inside the drawer.',
  '  const drawerLinks = await page.evaluate(() => ({',
  '    chips: document.querySelectorAll(\'[data-mindmap-card-links] [data-mindmap-link]\').length,',
  '    text: [...document.querySelectorAll(\'[data-mindmap-card-links] [data-mindmap-link]\')].map(n => n.textContent.trim()),',
  '  }))',
  "  check('抽屉里显示同一文件夹内卡片之间的连线',",
  '    drawerLinks.chips >= 1, JSON.stringify(drawerLinks))',
  '',
  '  // Drag the second card onto the first: the order must change and stay.',
  '  const beforeOrder = await page.evaluate(() =>',
  '    [...document.querySelectorAll(\'[data-stack-card]\')].map(n => n.getAttribute(\'data-mindmap-session\')))',
  '  const dragResult = await page.evaluate(() => {',
  '    const cards = [...document.querySelectorAll(\'[data-stack-card]\')]',
  '    if (cards.length < 2) return null',
  '    const from = cards[1]',
  '    const to = cards[0]',
  '    const box = to.getBoundingClientRect()',
  '    const data = new DataTransfer()',
  "    from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: data }))",
  '    to.dispatchEvent(new DragEvent(\'dragover\', {',
  '      bubbles: true, cancelable: true, dataTransfer: data,',
  '      clientX: box.x + box.width / 2, clientY: box.y + box.height / 2,',
  '    }))',
  '    to.dispatchEvent(new DragEvent(\'drop\', {',
  '      bubbles: true, cancelable: true, dataTransfer: data,',
  '      clientX: box.x + box.width / 2, clientY: box.y + box.height / 2,',
  '    }))',
  '    from.dispatchEvent(new DragEvent(\'dragend\', { bubbles: true, dataTransfer: data }))',
  '    return true',
  '  })',
  '  await page.waitForTimeout(900)',
  '  const afterOrder = await page.evaluate(() =>',
  '    [...document.querySelectorAll(\'[data-stack-card]\')].map(n => n.getAttribute(\'data-mindmap-session\')))',
  "  check('抽屉里拖动卡片可以改变排序并保留',",
  '    dragResult === true && beforeOrder.length >= 2',
  '      && beforeOrder.join() !== afterOrder.join(),',
  '    JSON.stringify({ before: beforeOrder, after: afterOrder }))',
]

const next = [...lines.slice(0, end + 1), ...block, ...lines.slice(end + 1)]
fs.writeFileSync(file, next.join('\n'), 'utf8')
console.log('inserted after', end + 1)
