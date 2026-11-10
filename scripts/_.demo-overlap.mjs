/**
 * 1) demo 模式把 ws-sync 框架下移，避免与 ws-lab 加高后重叠；
 * 2) demoMode 同时认 window.__mindMapDemo（file:// 下没有 location.search）。
 */
import fs from 'node:fs'

const file = 'test/harness.js'
let source = fs.readFileSync(file, 'utf8')
const D = source.includes('\r\n') ? '\r\n' : '\n'
const before = source

source = source.replace(
  "  const demoMode = new URLSearchParams(location.search).get('demo') === '1'",
  "  const demoMode = new URLSearchParams(location.search).get('demo') === '1' || window.__mindMapDemo === true",
)

source = source.replace(
  [
    `    grow('ws-daily', 1)`,
    `    FRAME_SHAPE['ws-daily'] = { cols: 3, rows: 2 }`,
  ].join(D),
  [
    `    grow('ws-daily', 1)`,
    `    // ws-lab grows a row too; push the shared folder below it so the two`,
    `    // frames never overlap on the demo board.`,
    `    frames['ws-sync'].y += 180`,
    `    FRAME_SHAPE['ws-daily'] = { cols: 3, rows: 2 }`,
  ].join(D),
)

if (source === before) {
  console.error('nothing changed')
  process.exit(1)
}
fs.writeFileSync(file, source, 'utf8')
console.log('overlap + flag source fixed')
