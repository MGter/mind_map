/**
 * Diagnostic: how early does a sibling card yield while another card is dragged
 * over it? Prints, mid-drag, the store reading order and each card's slot y.
 *
 *   node scripts/_drag-feel.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import { chromium } from 'playwright-core'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(candidate => fs.existsSync(candidate))
const PORT = 8795
const CDP = 9345
const profileDir = path.join(os.tmpdir(), 'mindmap-drag-profile')

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`)
  const rel = decodeURIComponent(url.pathname === '/' ? '/test/index.html' : url.pathname)
  const file = path.join(ROOT, rel)
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) {
    response.writeHead(404).end('not found')
    return
  }
  const type = rel.endsWith('.html') ? 'text/html; charset=utf-8'
    : rel.endsWith('.js') || rel.endsWith('.mjs') ? 'text/javascript; charset=utf-8'
      : 'text/css; charset=utf-8'
  response.writeHead(200, { 'content-type': type })
  response.end(fs.readFileSync(file))
})
await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve))

fs.rmSync(profileDir, { recursive: true, force: true })
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${profileDir}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync',
  '--window-size=1600,1000', '--headless=new', 'about:blank',
], { stdio: 'ignore', detached: false })

async function waitForCdp(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP}/json/version`)
      if (response.ok) return await response.json()
    } catch { /* not up */ }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error('no CDP')
}

const version = await waitForCdp()
console.log(`Edge ${version.Browser}`)
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP}`)
const context = browser.contexts()[0] ?? await browser.newContext()
const page = context.pages()[0] ?? await context.newPage()
page.on('pageerror', error => console.log('PAGEERROR', String(error)))

await page.goto(`http://127.0.0.1:${PORT}/test/index.html?run=${Date.now()}`)
await page.waitForTimeout(900)
await page.click('[class*="tm_sideButton"], [data-mindmap-toggle]').catch(() => {})
await page.evaluate(() => {
  const button = document.querySelector('[class*="tm_sideButton"]')
  if (button !== null) button.click()
})
await page.waitForTimeout(900)

const snapshot = () => page.evaluate(() => {
  const state = window.__harness.state()
  const nodes = [...document.querySelectorAll('.react-flow__node')]
  const rows = nodes.map(node => {
    const id = node.getAttribute('data-id')
    const card = state.cards[id]
    if (card === undefined) return null
    const r = node.getBoundingClientRect()
    return { id, sessionId: card.sessionId, storeX: Math.round(card.x), storeY: Math.round(card.y), screenY: Math.round(r.y), screenX: Math.round(r.x) }
  }).filter(row => row !== null)
  const order = [...rows].sort((a, b) => (a.storeY - b.storeY) || (a.storeX - b.storeX)).map(row => row.sessionId)
  return { rows, order }
})

const before = await snapshot()
console.log('\nBEFORE order:', before.order.join(' > '))
const first = before.rows.sort((a, b) => (a.storeY - b.storeY) || (a.storeX - b.storeX))[0]
const second = before.rows.sort((a, b) => (a.storeY - b.storeY) || (a.storeX - b.storeX))[1]
console.log('dragging', first.sessionId, 'over', second.sessionId)

const grab = await page.evaluate((sid) => {
  const state = window.__harness.state()
  const node = [...document.querySelectorAll('.react-flow__node')]
    .find(el => state.cards[el.getAttribute('data-id')]?.sessionId === sid)
  const r = node.getBoundingClientRect()
  return { x: Math.round(r.x + 60), y: Math.round(r.y + 12) }
}, first.sessionId)

await page.mouse.move(grab.x, grab.y)
await page.mouse.down()
for (const ratio of [0.2, 0.4, 0.6, 0.8, 1.0]) {
  const dy = Math.round(96 * ratio)
  await page.mouse.move(grab.x, grab.y + dy, { steps: 6 })
  await page.waitForTimeout(260)
  const now = await snapshot()
  const raw = await page.evaluate(() => ({ nodeIds: [...document.querySelectorAll('.react-flow__node')].map(n => n.getAttribute('data-id')), cardIds: Object.keys(window.__harness.state().cards) }));
  if (now.rows.every(row => row.sessionId !== first.sessionId)) { console.log('MISSING rows:', JSON.stringify(now.rows.map(r => r.sessionId))); console.log('  DOM nodeIds:', JSON.stringify(raw.nodeIds)); console.log('  store cardIds:', JSON.stringify(raw.cardIds)); }
  const target = now.rows.find(row => row.sessionId === second.sessionId) ?? { storeY: '?', screenY: '?' }
  const dragged = now.rows.find(row => row.sessionId === first.sessionId) ?? { storeY: '?', screenY: '?' }
  console.log(
    `drag ${Math.round(ratio * 100)}% (dy=${dy})  order=${now.order.slice(0, 3).join('>')}`,
    ` dragged storeY=${dragged.storeY} screenY=${dragged.screenY}`,
    ` neighbour storeY=${target.storeY} screenY=${target.screenY}`,
  )
}
await page.mouse.up()
await page.waitForTimeout(400)
const after = await snapshot()
console.log('\nAFTER order:', after.order.join(' > '))

await browser.close()
edge.kill()
server.close()
