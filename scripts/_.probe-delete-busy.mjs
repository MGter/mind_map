/**
 * Probe: deleting a card whose session is still busy must stop the work first
 * and retry, instead of showing the raw `session-open` refusal.
 */
import fs from 'node:fs'

const file = 'test/probe.mjs'
const lines = fs.readFileSync(file, 'utf8').split('\n')
const at = lines.findIndex(line => line.includes("check('右键归档调用 archiveSession 并移出地图'"))
if (at < 0) {
  console.error('anchor missing')
  process.exit(1)
}
let end = at
while (end < lines.length && !lines[end].includes('String(archived)')) end += 1

const block = [
  '',
  '  // ---- delete a busy session: stop the work, then move it to the bin ----',
  '  await page.evaluate(() => {',
  "    window.__harness.recycleBusy(true)",
  '  })',
  '  const busyPoint = await cardPoint(busySessionId)',
  "  await page.mouse.click(busyPoint.x, busyPoint.y, { button: 'right' })",
  '  await page.waitForTimeout(400)',
  '  const busyDeleteRow = await page.evaluate(() => {',
  "    const row = [...document.querySelectorAll('[class*=\"menuItem\"]')].find(node => node.textContent.includes('删除'))",
  '    if (row === undefined) return null',
  '    const box = row.getBoundingClientRect()',
  '    return { x: Math.round(box.x + 30), y: Math.round(box.y + box.height / 2) }',
  '  })',
  '  if (busyDeleteRow === null) {',
  "    check('会话还在跑时删除：先停止再删除', false, 'no delete row')",
  '  } else {',
  '    await page.mouse.click(busyDeleteRow.x, busyDeleteRow.y)',
  '    await page.waitForTimeout(4000)',
  '    const busyResult = await page.evaluate(() => ({',
  '      stopCalls: window.__harness.log.filter(entry => entry.kind === \"ui.archiveSession\" && entry.detail?.options?.stopActivity === true).length,',
  '      recycleCalls: window.__harness.recycleCalls().length,',
  "      toast: document.querySelector('[class*=\"toast\"]')?.textContent ?? null,",
  '      sessionLeft: [...document.querySelectorAll(\'[data-mindmap-session]\')].some(node => node.getAttribute(\'data-mindmap-session\') === ' + "'" + 'busySessionId' + "'" + '),',
  '    }))',
  "    check('会话还在跑时删除：先停止再删除',",
  '      busyResult.stopCalls >= 1 && busyResult.recycleCalls >= 2,',
  '      JSON.stringify(busyResult))',
  '  }',
]

const next = [...lines.slice(0, end + 1), ...block, ...lines.slice(end + 1)]
fs.writeFileSync(file, next.join('\n'), 'utf8')
console.log('inserted after', end + 1)
