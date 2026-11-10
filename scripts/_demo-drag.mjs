/**
 * Drag a connection on the real demo page (file:///…/demo/index.html) and look at
 * what gets drawn — the same gesture, on the same page, with the real plugin.
 *
 *   node scripts/_demo-drag.mjs [--shot name.png] [--by <fromIndex> <toIndex>]
 */
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const EDGE_BIN = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
  .find(candidate => fs.existsSync(candidate))
const port = 9461
const child = spawn(EDGE_BIN, [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(os.tmpdir(), 'demo-drag-' + Date.now())}`,
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
page.on('pageerror', error => console.log('PAGE ERROR:', String(error).slice(0, 240)))
await page.goto('file:///' + path.resolve('demo/index.html').replace(/\\/g, '/') + '?demo=1' + (process.argv.includes('--pair') ? '&pair=' + process.argv[process.argv.indexOf('--pair') + 1] : '') + (process.argv.includes('--handles') ? '&handles=' + process.argv[process.argv.indexOf('--handles') + 1] : ''))
await page.waitForTimeout(2500)

// Pick a vertical stack: a card that has another card well below it.
const plan = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('[data-mindmap-session]')].map(element => {
    const rect = element.getBoundingClientRect()
    return { id: element.getAttribute('data-mindmap-session'), x: rect.left, y: rect.top, w: rect.width, h: rect.height }
  })
  const handle = (card, handleId) => {
    for (const node of document.querySelectorAll('.react-flow__node')) {
      if (node.querySelector('[data-mindmap-session="' + card.id + '"]') === null) continue
      const element = node.querySelector('[data-handleid="' + handleId + '"]')
      if (element === null) continue
      const rect = element.getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    }
    return null
  }
  // source: leftmost of the first row; target: the card with the largest vertical
  // distance below the source, preferring the same column
  const forced = new URLSearchParams(location.search).get('pair')
  const forcedHandlesRaw = new URLSearchParams(location.search).get('handles')
  const forcedHandles = forcedHandlesRaw === null ? null : { from: forcedHandlesRaw.split(/[:>]/)[0], to: forcedHandlesRaw.split(/[:>]/)[1] }
  const source = (forced !== null ? cards.find(card => card.id === forced.split(/[:>]/)[0]) : undefined) ?? [...cards].sort((a, b) => (a.y - b.y) || (a.x - b.x))[0]
  // farthest card below, preferring the same column (that is the reported gesture:
  // a long vertical link with another card sitting in between)
  const below = cards.filter(card => card !== source && card.y > source.y + 150)
  const candidates = below.length > 0 ? below : cards.filter(card => card !== source && card.y > source.y + 60)
  candidates.sort((a, b) => (b.y - a.y) || (Math.abs(a.x - source.x) - Math.abs(b.x - source.x)))
  const target = (forced !== null ? cards.find(card => card.id === forced.split(/[:>]/)[1]) : undefined) ?? candidates[0] ?? cards.find(card => card !== source && card.y > source.y)
  return {
    source: { id: source.id, x: source.x, y: source.y, w: source.w, h: source.h },
    target: target === undefined ? null : { id: target.id, x: target.x, y: target.y, w: target.w, h: target.h },
    from: handle(source, forcedHandles?.from ?? 'b'),
    to: target === undefined ? null : handle(target, forcedHandles?.to ?? 't'),
    cards: cards.length,
  }
})
console.log('plan', JSON.stringify({ source: plan.source?.id, target: plan.target?.id, from: plan.from, to: plan.to, cards: plan.cards }))
if (plan.from === null || plan.to === null) {
  console.log('handles not found')
  await browser.close()
  child.kill()
  process.exit(1)
}

await page.mouse.move(plan.from.x, plan.from.y)
await page.mouse.down()
await page.mouse.move(plan.from.x, plan.from.y + 30, { steps: 4 })
await page.mouse.move(plan.to.x, plan.to.y, { steps: 18 })
await page.mouse.up()
await page.waitForTimeout(1000)

const report = await page.evaluate(({ sourceId, targetId }) => {
  const cards = [...document.querySelectorAll('[data-mindmap-session]')].map(element => {
    const rect = element.getBoundingClientRect()
    return { id: element.getAttribute('data-mindmap-session'), x: rect.left, y: rect.top, w: rect.width, h: rect.height }
  })
  const out = []
  for (const group of document.querySelectorAll('.react-flow__edge')) {
    const element = group.querySelector('.react-flow__edge-path')
    if (element === null) continue
    const total = element.getTotalLength()
    const pointAt = distance => element.getPointAtLength(distance)
    const matrix = element.getScreenCTM()
    const screenAt = distance => {
      const local = pointAt(distance)
      return matrix === null ? local : local.matrixTransform(matrix)
    }
    const own = new Set()
    cards.forEach((card, index) => {
      for (const point of [screenAt(0), screenAt(total)]) {
        if (point.x > card.x - 6 && point.x < card.x + card.w + 6 && point.y > card.y - 6 && point.y < card.y + card.h + 6) own.add(index)
      }
    })
    let inside = 0
    const hits = new Set()
    for (let distance = 0; distance <= total; distance += 2) {
      const point = screenAt(distance)
      cards.forEach((card, index) => {
        if (own.has(index)) return
        if (point.x > card.x + 1 && point.x < card.x + card.w - 1 && point.y > card.y + 1 && point.y < card.y + card.h - 1) {
          inside += 1
          hits.add(card.id)
        }
      })
    }
    out.push({
      id: group.getAttribute('data-id'),
      inside,
      hits: [...hits].map(id => String(id).slice(0, 8)),
      d: element.getAttribute('d').slice(0, 120),
    })
  }
  return { edges: out, newPair: [sourceId, targetId] }
}, { sourceId: plan.source.id, targetId: plan.target?.id })

const dbg = await page.evaluate(() => (window.__edgeDebug ?? []).slice(-3))
console.log('EDGE DEBUG', JSON.stringify(dbg))
const shot = process.argv.includes('--shot') ? process.argv[process.argv.indexOf('--shot') + 1] : 'test/shots/demo-drag.png'
await page.screenshot({ path: shot })
await browser.close()
child.kill()

console.log(JSON.stringify({
  edges: report.edges.length,
  crossing: report.edges.filter(edge => edge.inside > 0).length,
  detail: report.edges.filter(edge => edge.inside > 0).slice(0, 3),
}, null, 1))
process.exitCode = report.edges.some(edge => edge.inside > 0) ? 1 : 0
