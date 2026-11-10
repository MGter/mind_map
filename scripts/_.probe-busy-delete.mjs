/** Insert the delete-when-busy probe check. */
import fs from 'node:fs'

const file = 'test/probe.mjs'
const lines = fs.readFileSync(file, 'utf8').split('\n')
const at = lines.findIndex(line => line.includes("check('删除走 dsh-recycle-bin 的 trash 接口'"))
if (at < 0) {
  console.error('anchor missing')
  process.exit(1)
}

const block = [
  '',
  '  // A session that still has work must be stopped, then moved — not refused.',
  '  await page.evaluate(() => window.__harness.recycleBusy(true, 1))',
  "  const busyPoint = await cardPoint('s8')",
  "  await page.mouse.click(busyPoint.x, busyPoint.y, { button: 'right' })",
  '  await page.waitForTimeout(400)',
  "  await clickMenuItem('删除会话')",
  '  await page.waitForTimeout(3000)',
  '  const busyDelete = await page.evaluate(() => ({',
  "    stopCalls: window.__harness.log.filter(entry => entry.kind === 'ui.archiveSession' && entry.detail?.options?.stopActivity === true).length,",
  '    recycleCalls: window.__harness.recycleCalls().length,',
  '    stillThere: [...document.querySelectorAll(\'[data-mindmap-session]\')].some(node => node.getAttribute(\'data-mindmap-session\') === \'s8\'),',
  '  }))',
  "  check('会话还在跑时删除：先停止工作再重试删除',",
  '    busyDelete.stopCalls >= 1 && busyDelete.stillThere === false,',
  '    JSON.stringify(busyDelete))',
]

const next = [...lines.slice(0, at + 1), ...block, ...lines.slice(at + 1)]
fs.writeFileSync(file, next.join('\n'), 'utf8')
console.log('inserted after', at + 1)
