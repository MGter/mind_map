/**
 * Two checks on the map page: (1) every arrow head points into its card, (2) no two edges
 * run on top of each other as a "doubled line".
 *
 *   node scripts/_map-twins.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
  .find(candidate => fs.existsSync(candidate))
const port = 9571
const child = spawn(EDGE, [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(os.tmpdir(), 'tw-' + Date.now())}`,
  '--no-first-run', '--headless=new', '--window-size=1700,1050', 'about:blank'], { stdio: 'ignore' })

let ready = false
const started = Date.now()
while (Date.now() - started < 20000 && !ready) {
  try { ready = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok } catch { /* not up */ }
  if (!ready) await new Promise(resolve => setTimeout(resolve, 200))
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const page = browser.contexts()[0].pages()[0] ?? await browser.contexts()[0].newPage()
await page.setViewportSize({ width: 1700, height: 1050 })
await page.goto('file:///' + path.resolve('demo/index.html').replace(/\\/g, '/') + '?demo=1')
await page.waitForTimeout(2500)

const report = await page.evaluate(() => {
  const container = document.querySelector('.react-flow__edges')
  if (container === null) return { error: 'no edges layer' }
  const svg = container.tagName.toLowerCase() === 'svg' ? container : container.querySelector('svg')
  const matrix = svg === null ? null : svg.getScreenCTM()
  const toScreen = point => (matrix === null ? point : new DOMPoint(point.x, point.y).matrixTransform(matrix))

  const cards = [...document.querySelectorAll('[data-mindmap-session]')].map(element => {
    const rect = element.getBoundingClientRect()
    return { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
  })

  // React Flow draws an invisible wide 'interaction' path on top of every visible one;
  // it is the same geometry and would look like a duplicate line to this check.
  const paths = [...container.querySelectorAll('path')].filter(element => {
    const d = element.getAttribute('d') ?? ''
    const cls = element.getAttribute('class') ?? ''
    return d.length > 20 && !d.startsWith('M0 0') && !cls.includes('interaction')
  })

  const lines = paths.map(element => {
    const total = element.getTotalLength()
    const points = []
    for (let distance = 0; distance <= total; distance += 3) points.push(toScreen(element.getPointAtLength(distance)))
    return { points, tip: points[points.length - 1] }
  })

  // (1) arrows: the head is the small triangle; its transform gives tip + angle.
  const heads = [...container.querySelectorAll('path')].filter(element => (element.getAttribute('d') ?? '').startsWith('M0 0'))
  const arrows = heads.map(element => {
    const transform = element.getAttribute('transform') ?? ''
    const translate = /translate\(([-\d.]+)[ ,]([-\d.]+)\)/.exec(transform)
    const rotate = /rotate\(([-\d.]+)\)/.exec(transform)
    if (translate === null) return null
    const point = toScreen({ x: Number(translate[1]), y: Number(translate[2]) })
    return { x: point.x, y: point.y, angle: rotate === null ? 0 : Number(rotate[1]) }
  }).filter(Boolean)

  const badArrows = []
  for (const arrow of arrows) {
    let nearest = null
    let best = Number.POSITIVE_INFINITY
    for (const card of cards) {
      const dx = Math.max(card.x - arrow.x, 0, arrow.x - (card.x + card.w))
      const dy = Math.max(card.y - arrow.y, 0, arrow.y - (card.y + card.h))
      const distance = Math.hypot(dx, dy)
      if (distance < best) { best = distance; nearest = card }
    }
    if (nearest === null || best > 8) continue
    const radians = (arrow.angle * Math.PI) / 180
    const dir = { x: Math.cos(radians), y: Math.sin(radians) }
    const normal = [
      { d: Math.abs(arrow.y - nearest.y), n: { x: 0, y: 1 } },
      { d: Math.abs(arrow.y - (nearest.y + nearest.h)), n: { x: 0, y: -1 } },
      { d: Math.abs(arrow.x - nearest.x), n: { x: 1, y: 0 } },
      { d: Math.abs(arrow.x - (nearest.x + nearest.w)), n: { x: -1, y: 0 } },
    ].sort((a, b) => a.d - b.d)[0].n
    const inward = dir.x * normal.x + dir.y * normal.y
    if (inward < 0.7) badArrows.push({ x: Math.round(arrow.x), y: Math.round(arrow.y), angle: arrow.angle, inward: Math.round(inward * 100) / 100 })
  }

  // (2) doubled lines: how much of one edge lies within 6px of another edge.
  const twins = []
  for (let a = 0; a < lines.length; a += 1) {
    for (let b = a + 1; b < lines.length; b += 1) {
      let close = 0
      for (const pointA of lines[a].points) {
        for (const pointB of lines[b].points) {
          if (Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y) < 6) { close += 1; break }
        }
      }
      const share = close / Math.max(1, lines[a].points.length)
      if (share > 0.35) twins.push({ a, b, share: Math.round(share * 100) / 100 })
    }
  }

  return { edges: lines.length, arrows: arrows.length, badArrows, twins }
})

await browser.close()
child.kill()
console.log(JSON.stringify(report, null, 1))
process.exitCode = (report.badArrows?.length ?? 0) === 0 && (report.twins?.length ?? 0) === 0 ? 0 : 1
