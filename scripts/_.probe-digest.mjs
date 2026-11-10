/** Insert the 查看摘要 probe checks after the card-menu assertion. */
import fs from 'node:fs'

const file = 'test/probe.mjs'
const lines = fs.readFileSync(file, 'utf8').split('\n')
const at = lines.findIndex(line => line.includes("check('右键菜单含置顶/标为未读/归档/删除/批量'"))
if (at < 0) {
  console.error('anchor missing')
  process.exit(1)
}
// the check spans two lines; find its closing line
let end = at
while (end < lines.length && !lines[end].trim().endsWith('JSON.stringify(cardMenu))')) end += 1

const block = [
  "  // 查看摘要：read-only preview of exactly what this card would push.",
  "  check('卡片菜单里有「查看摘要」', cardMenu.some(text => text.includes('查看摘要')), JSON.stringify(cardMenu))",
  '  const digestRow = await page.evaluate(() => {',
  '    const rows = [...document.querySelectorAll(\'[class*="menuItem"]\')]',
  "    const row = rows.find(node => node.textContent.includes('查看摘要'))",
  '    if (row === undefined) return null',
  '    const box = row.getBoundingClientRect()',
  "    return { x: Math.round(box.x + 30), y: Math.round(box.y + box.height / 2), disabled: row.getAttribute('aria-disabled') === 'true' }",
  '  })',
  '  if (digestRow !== null && digestRow.disabled === false) {',
  '    await page.mouse.click(digestRow.x, digestRow.y)',
  '    await page.waitForTimeout(500)',
  '    const digestDialog = await page.evaluate(() => {',
  "      const dialog = document.querySelector('[data-mindmap-digest-dialog]')",
  '      if (dialog === null) return null',
  "      const areas = [...dialog.querySelectorAll('textarea')].map(node => node.value)",
  "      return { areas: areas.length, hasRecall: areas.some(text => text.includes('提醒')), sample: (areas[0] ?? '').slice(0, 50) }",
  '    })',
  "    check('「查看摘要」是只读预览，并带上“去看完整对话”的提醒',",
  '      digestDialog !== null && digestDialog.areas >= 1 && digestDialog.hasRecall === true,',
  '      JSON.stringify(digestDialog))',
  "    await page.keyboard.press('Escape')",
  '    await page.waitForTimeout(300)',
  '  } else {',
  "    check('「查看摘要」是只读预览，并带上“去看完整对话”的提醒', false, 'menu row missing/disabled')",
  '  }',
]

const next = [...lines.slice(0, end + 1), ...block, ...lines.slice(end + 1)]
fs.writeFileSync(file, next.join('\n'), 'utf8')
console.log('inserted after line', end + 1)
