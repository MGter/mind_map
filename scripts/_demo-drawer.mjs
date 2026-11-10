/**
 * Open the stack drawer on the real demo page (current build), then measure the wires
 * against the cards — the two symptoms reported: a wire leaving the panel, and wires
 * that do not line up with the cards they connect.
 *
 *   node scripts/_demo-drawer.mjs [--shot name.png]
 */
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const EDGE_BIN = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
  .find(candidate => fs.existsSync(candidate))
const port = 9511
const child = spawn(EDGE_BIN, [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(os.tmpdir(), 'demo-drawer-' + Date.now())}`,
  '--no-first-run', '--disable-extensions', '--window-size=1700,1050', '--headless=new', 'about:blank'], { stdio: 'ignore' })

let ready = false
const started = Date.now()
while (Date.now() - started < 20000 && !ready) {
  try { ready = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok } catch { /* not up */ }
  if (!ready) await new Promise(resolve => setTimeout(resolve, 200))
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const page = browser.contexts()[0].pages()[0] ?? await browser.contexts()[0].newPage()
await page.setViewportSize({ width: 1700, height: 1050 })
page.on('pageerror', error => console.log('PAGE ERROR:', String(error).slice(0, 200)))
await page.goto('file:///' + path.resolve('demo/index.html').replace(/\\/g, '/') + '?demo=1')
await page.waitForTimeout(2500)

// A stack cell is a card that shows "+N" — open it.
const opened = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('[data-mindmap-session]')]
  for (const cell of cells) {
    const text = cell.textContent ?? ''
    if (!/^\s*\+\d+/.test(text) && !/\+\d+/.test(text)) continue
    cell.click()
    return { clicked: cell.getAttribute('data-mindmap-session'), text: text.slice(0, 12) }
  }
  return null
})
console.log('stack cell:', JSON.stringify(opened))
await page.waitForTimeout(1200)

const report = await page.evaluate(() => {
  const scroller = document.querySelector('[class*="drawerScroll"]')
  if (scroller === null) return { error: 'no drawer' }
  const base = scroller.getBoundingClientRect()
  const cards = [...scroller.querySelectorAll('[data-card-id]')].map(element => {
    const rect = element.getBoundingClientRect()
    return { id: element.getAttribute('data-card-id'),
      x: rect.left - base.left, y: rect.top - base.top, w: rect.width, h: rect.height }
  })
  const wires = [...scroller.querySelectorAll('svg path')]
    .filter(element => (element.getAttribute('fill') ?? '') === 'none')
    .map(element => {
      const total = element.getTotalLength()
      const points = []
      for (let distance = 0; distance <= total; distance += 2) points.push(element.getPointAtLength(distance))
      let outside = 0
      for (const point of points) {
        if (point.x < -1 || point.y < -1 || point.x > scroller.clientWidth + 1 || point.y > scroller.scrollHeight + 1) outside += 1
      }
      const gap = point => Math.min(...cards.map(card => Math.hypot(
        Math.max(card.x - point.x, 0, point.x - (card.x + card.w)),
        Math.max(card.y - point.y, 0, point.y - (card.y + card.h)),
      )))
      return {
        d: (element.getAttribute('d') ?? '').slice(0, 70),
        outside,
        headGap: Math.round(gap(points[0]) * 10) / 10,
        tailGap: Math.round(gap(points[points.length - 1]) * 10) / 10,
        cross: (() => {
          let hits = 0
          for (const point of points) {
            for (const card of cards) {
              if (point.x > card.x + 1 && point.x < card.x + card.w - 1
                && point.y > card.y + 1 && point.y < card.y + card.h - 1) hits += 1
            }
          }
          return hits
        })(),
      }
    })
  return { cards: cards.length, wires }
})

const shot = process.argv.includes('--shot') ? process.argv[process.argv.indexOf('--shot') + 1] : 'test/shots/demo-drawer.png'
await page.screenshot({ path: shot })
await browser.close()
child.kill()

if (report.error !== undefined) {
  console.log(JSON.stringify(report))
  process.exitCode = 1
} else {
  const bad = report.wires.filter(wire => wire.outside > 0 || wire.cross > 0 || wire.headGap > 6 || wire.tailGap > 6)
  console.log(JSON.stringify({ cards: report.cards, wires: report.wires.length, bad: bad.length, detail: bad.slice(0, 4) }, null, 1))
  process.exitCode = bad.length === 0 ? 0 : 1
}
