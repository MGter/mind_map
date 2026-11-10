/** Split the synthetic drag into steps (React state needs a commit between them). */
import fs from 'node:fs'

const file = 'test/probe.mjs'
const lines = fs.readFileSync(file, 'utf8').split('\n')
const start = lines.findIndex(line => line.includes("const dragResult = await page.evaluate(() => {"))
if (start < 0) {
  console.error('drag block not found')
  process.exit(1)
}
let end = start
while (end < lines.length && !lines[end].includes("check('抽屉里拖动卡片可以改变排序并保留'")) end += 1
// include the check's following lines
let stop = end
while (stop < lines.length && !lines[stop].includes('JSON.stringify({ before: beforeOrder, after: afterOrder }))')) stop += 1

const block = [
  '  // Drive the drag in steps: React has to commit the dragstart state before',
  '  // the dragover handler will accept a drop.',
  '  await page.evaluate(() => {',
  "    const cards = [...document.querySelectorAll('[data-stack-card]')]",
  '    if (cards.length < 2) return',
  '    window.__dragData = new DataTransfer()',
  "    cards[1].dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.__dragData }))",
  '  })',
  '  await page.waitForTimeout(350)',
  '  await page.evaluate(() => {',
  "    const cards = [...document.querySelectorAll('[data-stack-card]')]",
  '    if (cards.length < 2) return',
  '    const box = cards[0].getBoundingClientRect()',
  '    cards[0].dispatchEvent(new DragEvent(\'dragover\', {',
  '      bubbles: true, cancelable: true, dataTransfer: window.__dragData,',
  '      clientX: box.x + box.width / 2, clientY: box.y + box.height / 2,',
  '    }))',
  '  })',
  '  await page.waitForTimeout(350)',
  '  await page.evaluate(() => {',
  "    const cards = [...document.querySelectorAll('[data-stack-card]')]",
  '    if (cards.length < 2) return',
  '    const box = cards[0].getBoundingClientRect()',
  '    cards[0].dispatchEvent(new DragEvent(\'drop\', {',
  '      bubbles: true, cancelable: true, dataTransfer: window.__dragData,',
  '      clientX: box.x + box.width / 2, clientY: box.y + box.height / 2,',
  '    }))',
  '  })',
  '  await page.waitForTimeout(900)',
  '  const afterOrder = await page.evaluate(() =>',
  "    [...document.querySelectorAll('[data-stack-card]')].map(n => n.getAttribute('data-mindmap-session')))",
  "  check('抽屉里拖动卡片可以改变排序并保留',",
  '    beforeOrder.length >= 2 && beforeOrder.join() !== afterOrder.join(),',
  '    JSON.stringify({ before: beforeOrder, after: afterOrder }))',
]

const next = [...lines.slice(0, start), ...block, ...lines.slice(stop + 1)]
fs.writeFileSync(file, next.join('\n'), 'utf8')
console.log(`replaced ${start + 1}..${stop + 1}`)
