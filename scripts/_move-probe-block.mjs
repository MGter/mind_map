/** Move the drawer-persistence block to after the batch section, and log storage. */
import fs from 'node:fs'

const probe = 'test/probe.mjs'
const lines = fs.readFileSync(probe, 'utf8').split('\n')

const start = lines.findIndex(line => line.includes('// ---- 11b. the stack drawer survives jumping into a conversation'))
if (start < 0) {
  console.error('block start not found')
  process.exit(1)
}
// the block ends right before the batch delete evaluate
let end = start
while (end < lines.length && !lines[end].includes('\'[class*="tm_batchAction"]\'')) end += 1
let blockEnd = end
while (blockEnd > start && !lines[blockEnd].includes('await page.evaluate(() => {')) blockEnd -= 1
const block = lines.slice(start, blockEnd)
const rest = [...lines.slice(0, start), ...lines.slice(blockEnd)]

// extra diagnostics inside the block
const withDebug = block.flatMap((line) => {
  if (line.includes("check('回到地图时抽屉还开着")) {
    return [
      '  const storedDrawer = await page.evaluate(() => ({',
      "    stored: localStorage.getItem('dsh.mind_map.drawer.v1'),",
      "    scroll: localStorage.getItem('dsh.mind_map.drawer-scroll.v1'),",
      '  }))',
      '  console.log(\'   drawer storage:\', JSON.stringify(storedDrawer))',
      line,
    ]
  }
  return [line]
})

// insert after the batch-mode exit check
const anchor = rest.findIndex(line => line.includes("check('批量删除后退出批量模式'"))
if (anchor < 0) {
  console.error('anchor not found')
  process.exit(1)
}
const next = [...rest.slice(0, anchor + 1), '', ...withDebug, ...rest.slice(anchor + 1)]
fs.writeFileSync(probe, next.join('\n'), 'utf8')
console.log(`moved block of ${block.length} lines to after line ${anchor + 1}`)
