/**
 * Render the user's REAL board through the REAL plugin canvas (test/index.html +
 * harness.js), by seeding the harness's saved state with mind_map.json.
 *
 * This is the faithful repro: same component, same CSS, same data — then the
 * rendered SVG paths are measured against the rendered cards in screen space.
 *
 *   node scripts/_real-canvas.mjs [--shot name.png]
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const raw = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.dsh', 'storages', 'mind_map.json'), 'utf8'))
const seed = {
  cards: raw.tables.cards,
  edges: raw.tables.edges,
  digests: raw.tables.digests ?? {},
  global: raw.global,
}

const EDGE_BIN = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(candidate => fs.existsSync(candidate))
const port = 9431
const child = spawn(EDGE_BIN, [
  `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(os.tmpdir(), 'real-canvas-' + Date.now())}`,
  '--no-first-run', '--disable-extensions', '--window-size=1800,1100', '--headless=new', 'about:blank',
], { stdio: 'ignore' })

let ready = false
const started = Date.now()
while (Date.now() - started < 20000 && !ready) {
  try { ready = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok } catch { /* not up */ }
  if (!ready) await new Promise(resolve => setTimeout(resolve, 200))
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const context = browser.contexts()[0]
await context.addInitScript(payload => {
  window.localStorage.setItem('mind_map.demo-state.v1', JSON.stringify(payload))
}, seed)

const page = context.pages()[0] ?? await context.newPage()
await page.setViewportSize({ width: 1800, height: 1100 })
await page.goto('file:///' + path.resolve('test/index.html').replace(/\\/g, '/'))
await page.waitForTimeout(2500)
// open the map overlay (the harness listens for the plugin's hotkey)
const booted = await page.evaluate(() => {
  const harness = window.__harness
  if (!harness) return { harness: false }
  const already = document.querySelectorAll('.react-flow').length
  if (already === 0) { try { harness.boot() } catch (error) { return { harness: true, error: String(error).slice(0, 200) } } }
  return { harness: true, before: already }
})
console.log('BOOT', JSON.stringify(booted))
await page.waitForTimeout(2500)

const report = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('[data-mindmap-session]')].map(element => {
    const rect = element.getBoundingClientRect()
    return { id: element.getAttribute('data-mindmap-session'), x: rect.left, y: rect.top, w: rect.width, h: rect.height }
  })
  const out = []
  for (const group of document.querySelectorAll('.react-flow__edge')) {
    const element = group.querySelector('.react-flow__edge-path')
    if (element === null) continue
    const matrix = element.getScreenCTM()
    const total = element.getTotalLength()
    const pointAt = distance => {
      const local = element.getPointAtLength(distance)
      return matrix === null ? local : local.matrixTransform(matrix)
    }
    const own = new Set()
    cards.forEach((card, index) => {
      for (const point of [pointAt(0), pointAt(total)]) {
        if (point.x > card.x - 6 && point.x < card.x + card.w + 6 && point.y > card.y - 6 && point.y < card.y + card.h + 6) own.add(index)
      }
    })
    const hits = new Set()
    let inside = 0
    let closest = Infinity
    for (let distance = 0; distance <= total; distance += 2) {
      const point = pointAt(distance)
      cards.forEach((card, index) => {
        if (own.has(index)) return
        const dx = Math.max(card.x - point.x, 0, point.x - (card.x + card.w))
        const dy = Math.max(card.y - point.y, 0, point.y - (card.y + card.h))
        const away = Math.hypot(dx, dy)
        if (away < closest) closest = away
        if (away === 0) { inside += 1; hits.add(String(card.id).slice(-6)) }
      })
    }
    out.push({
      id: group.getAttribute('data-id'),
      inside,
      closest: Math.round(closest * 10) / 10,
      hits: [...hits].slice(0, 3),
      d: element.getAttribute('d').slice(0, 80),
    })
  }
  return {
    cards: cards.length,
    sizes: [...new Set(cards.map(card => Math.round(card.w) + 'x' + Math.round(card.h)))],
    edges: out,
  }
})

const shot = process.argv.includes('--shot') ? process.argv[process.argv.indexOf('--shot') + 1] : 'test/shots/real-canvas.png'
await page.screenshot({ path: shot, fullPage: false })
await browser.close()
child.kill()

const crossing = report.edges.filter(edge => edge.inside > 0)
console.log(JSON.stringify({
  cards: report.cards,
  cardSizes: report.sizes,
  edges: report.edges.length,
  crossing: crossing.length,
  worstClearance: Math.min(...report.edges.map(edge => edge.closest)),
  detail: crossing.slice(0, 5),
}, null, 1))
process.exitCode = crossing.length === 0 ? 0 : 1
