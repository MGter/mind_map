/**
 * Measure the demo page's *rendered* edges against its *rendered* cards.
 *
 * Everything happens in screen space: `getScreenCTM` maps path points exactly and
 * `getBoundingClientRect` gives the cards exactly — no manual viewport maths, which
 * is where earlier measurements went wrong (a 320px offset made every check lie).
 *
 *   node scripts/_demo-verify.mjs [--shot name.png]
 */
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const EDGE_BIN = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(candidate => fs.existsSync(candidate))

const port = 9411
const profile = path.join(os.tmpdir(), 'demo-verify-' + Date.now())
const child = spawn(EDGE_BIN, [
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-extensions', '--window-size=1700,1050', '--headless=new', 'about:blank',
], { stdio: 'ignore' })

let ready = false
const started = Date.now()
while (Date.now() - started < 20000 && !ready) {
  try { ready = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok } catch { /* not up yet */ }
  if (!ready) await new Promise(resolve => setTimeout(resolve, 200))
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const page = browser.contexts()[0].pages()[0] ?? await browser.contexts()[0].newPage()
await page.setViewportSize({ width: 1700, height: 1050 })
await page.goto('file:///' + path.resolve('demo/index.html').replace(/\\/g, '/') + '?demo=1')
page.on('pageerror', error => console.log('PAGE ERROR:', String(error).slice(0, 220)))
page.on('console', message => { if (message.type() === 'error') console.log('CONSOLE:', message.text().slice(0, 220)) })
await page.waitForTimeout(2500)

const report = await page.evaluate(() => {
  // 路径总长度：用来判断有没有只剩一小截的碎片
  const element_length = path => {
    const probe = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    probe.setAttribute('d', path)
    try { return probe.getTotalLength() } catch { return 0 }
  }
  const cards = [...document.querySelectorAll('[data-mindmap-session]')].map(element => {
    const rect = element.getBoundingClientRect()
    return { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
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
    const first = pointAt(0)
    const last = pointAt(total)
    const own = new Set()
    cards.forEach((card, index) => {
      for (const point of [first, last]) {
        if (point.x > card.x - 4 && point.x < card.x + card.w + 4 && point.y > card.y - 4 && point.y < card.y + card.h + 4) own.add(index)
      }
    })
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
        if (away === 0) inside += 1
      })
    }
    out.push({ id: group.getAttribute('data-id'), inside, closest: Math.round(closest * 10) / 10 })
  }
  const paths = [...document.querySelectorAll('.react-flow__edge-path')].map(element => element.getAttribute('d') ?? '')
  const brokenStubs = paths.filter(path => (path.match(/M/g) ?? []).length > 1).length
  const tooShort = paths.filter(path => element_length(path) < 24).length
  return {
    brokenStubs,
    tooShort,
    cardCount: cards.length,
    sizes: [...new Set(cards.map(card => Math.round(card.w) + 'x' + Math.round(card.h)))],
    edges: out,
  }
})


// Arrow heads: they are drawn behind the cards, so a head that straddles a border loses
// half of itself; and a head whose angle came from the wrong segment points backwards.
const arrowReport = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('[data-mindmap-session]')].map(element => {
    const rect = element.getBoundingClientRect()
    return { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
  })
  const svg = document.querySelector('.react-flow__edges svg') ?? document.querySelector('.react-flow__edges')
  if (svg === null) return { arrows: 0, bad: [] }
  const paths = [...svg.querySelectorAll('path')]
  const heads = []
  for (const element of paths) {
    const transform = element.getAttribute('transform') ?? ''
    if (!transform.includes('translate')) continue
    const translate = /translate\(([-\d.]+)[ ,]([-\d.]+)\)/.exec(transform)
    const rotate = /rotate\(([-\d.]+)\)/.exec(transform)
    if (translate === null) continue
    heads.push({ x: Number(translate[1]), y: Number(translate[2]), angle: rotate === null ? 0 : Number(rotate[1]) })
  }
  const bad = []
  for (const head of heads) {
    // Convert to screen space via the SVG's own transform.
    const matrix = svg.getScreenCTM?.()
    const point = matrix === null || matrix === undefined
      ? head
      : new DOMPoint(head.x, head.y).matrixTransform(matrix)
    let nearest = null
    let best = Number.POSITIVE_INFINITY
    for (const card of cards) {
      const dx = Math.max(card.x - point.x, 0, point.x - (card.x + card.w))
      const dy = Math.max(card.y - point.y, 0, point.y - (card.y + card.h))
      const distance = Math.hypot(dx, dy)
      if (distance < best) { best = distance; nearest = card }
    }
    if (nearest === null || best > 6) continue
    const radians = (head.angle * Math.PI) / 180
    const dir = { x: Math.cos(radians), y: Math.sin(radians) }
    const edges = [
      { d: Math.abs(point.y - nearest.y), n: { x: 0, y: 1 } },
      { d: Math.abs(point.y - (nearest.y + nearest.h)), n: { x: 0, y: -1 } },
      { d: Math.abs(point.x - nearest.x), n: { x: 1, y: 0 } },
      { d: Math.abs(point.x - (nearest.x + nearest.w)), n: { x: -1, y: 0 } },
    ].sort((a, b) => a.d - b.d)
    const normal = edges[0].n
    const inward = dir.x * normal.x + dir.y * normal.y
    if (inward < 0.7) bad.push({ x: Math.round(point.x), y: Math.round(point.y), angle: head.angle, inward: Math.round(inward * 100) / 100 })
  }
  return { arrows: heads.length, bad }
})
console.log('ARROWS', JSON.stringify(arrowReport))

const shot = process.argv.includes('--shot') ? process.argv[process.argv.indexOf('--shot') + 1] : 'test/shots/demo-verify.png'
await page.screenshot({ path: shot, fullPage: false })
const zoomCheck = await page.evaluate(async () => {
  const read = () => [...document.querySelectorAll('.react-flow__edge-path')].map(el => el.getAttribute('d'))
  const before = read()
  const pane = document.querySelector('.react-flow__pane')
  const box = pane.getBoundingClientRect()
  for (const delta of [-300, -300, 600, 600]) {
    pane.dispatchEvent(new WheelEvent('wheel', { deltaY: delta, ctrlKey: true, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, bubbles: true, cancelable: true }))
    await new Promise(resolve => setTimeout(resolve, 120))
  }
  await new Promise(resolve => setTimeout(resolve, 400))
  const after = read()
  const same = JSON.stringify(before) === JSON.stringify(after)
  let diff = null
  if (!same) {
    for (let index = 0; index < Math.max(before.length, after.length); index += 1) {
      if (before[index] !== after[index]) { diff = { index, before: before[index]?.slice(0, 120), after: after[index]?.slice(0, 120) }; break }
    }
  }
  return { same, diff, count: [before.length, after.length] }
})
console.log('ZOOM', JSON.stringify(zoomCheck))

await browser.close()
child.kill()

const crossing = report.edges.filter(edge => edge.inside > 0)
console.log(JSON.stringify({
  cards: report.cardCount,
  brokenStubs: report.brokenStubs,
  tooShort: report.tooShort,
  sizes: report.sizes,
  edges: report.edges.length,
  crossing: crossing.length,
  worstClearance: Math.min(...report.edges.map(edge => edge.closest)),
  detail: crossing.slice(0, 4),
}, null, 1))
process.exitCode = crossing.length === 0 ? 0 : 1
