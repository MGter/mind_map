/**
 * Diagnostic: does a neighbour yield while a card is dragged over it?
 * Samples the RENDERED slot positions mid-drag (the store follows the pointer,
 * so only on-screen geometry shows whether the layout yielded).
 *
 *   node scripts/_yield-feel.mjs
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
const PORT = 8796
const CDP = 9346
const profileDir = path.join(os.tmpdir(), 'mindmap-yield-profile')

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`)
  const rel = decodeURIComponent(url.pathname === '/' ? '/test/index.html' : url.pathname)
  const file = path.join(ROOT, rel)
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) {
    response.writeHead(404).end('not found')
    return
  }
  const type = rel.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8'
  response.writeHead(200, { 'content-type': type })
  response.end(fs.readFileSync(file))
})
await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve))

fs.rmSync(profileDir, { recursive: true, force: true })
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${profileDir}`,
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
await page.evaluate(() => {
  const button = document.querySelector('[class*="tm_sideButton"]')
  if (button !== null) button.click()
})
await page.waitForTimeout(900)

const positions = () => page.evaluate(() => {
  const state = window.__harness.state()
  return [...document.querySelectorAll('.react-flow__node')]
    .map((node) => {
      const card = state.cards[node.getAttribute('data-id')]
      if (card === undefined) return null
      const r = node.getBoundingClientRect()
      return { sessionId: card.sessionId, x: Math.round(r.x), y: Math.round(r.y) }
    })
    .filter(entry => entry !== null)
})

const start = await positions()
const row = [...start].sort((a, b) => (a.y - b.y) || (a.x - b.x))
const source = row[0]
const neighbour = row[1]
console.log('source', source.sessionId, '@', source.x, source.y, '/ neighbour', neighbour.sessionId, '@', neighbour.x, neighbour.y)

const grab = await page.evaluate((sid) => {
  const state = window.__harness.state()
  const node = [...document.querySelectorAll('.react-flow__node')]
    .find(el => state.cards[el.getAttribute('data-id')]?.sessionId === sid)
  const r = node.getBoundingClientRect()
  return { x: Math.round(r.x + 60), y: Math.round(r.y + 12) }
}, source.sessionId)

await page.mouse.move(grab.x, grab.y)
await page.mouse.down()
for (const dx of [60, 140, 220, 260, 300]) {
  await page.mouse.move(grab.x + dx, grab.y, { steps: 5 })
  await page.waitForTimeout(280)
  const now = await positions()
  const moved = now.find(entry => entry.sessionId === neighbour.sessionId)
  const dragged = now.find(entry => entry.sessionId === source.sessionId)
  console.log(`dx=${dx}px  neighbour x=${moved?.x}  dragged x=${dragged?.x}`)
}
await page.mouse.up()
await page.waitForTimeout(500)
const end = await positions()
console.log('after drop:', JSON.stringify(end.sort((a, b) => (a.y - b.y) || (a.x - b.x)).map(e => e.sessionId)))

await browser.close()
edge.kill()
server.close()
