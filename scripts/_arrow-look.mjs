/**
 * Look at the map's arrow heads: read their angle, and crop a zoomed picture of one so the
 * direction can be judged by eye.
 *
 *   node scripts/_arrow-look.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
  .find(candidate => fs.existsSync(candidate))
const port = 9551
const child = spawn(EDGE, [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(os.tmpdir(), 'look-' + Date.now())}`,
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

const heads = await page.evaluate(() => {
  const svg = document.querySelector('.react-flow__edges svg')
  const edgePath = document.querySelector('.react-flow__edge-path')
  let tip = null
  if (edgePath !== null) {
    const matrix = svg === null ? null : svg.getScreenCTM()
    const local = edgePath.getPointAtLength(edgePath.getTotalLength())
    tip = matrix === null ? null : new DOMPoint(local.x, local.y).matrixTransform(matrix)
  }
  const dump = [...(svg === null ? [] : svg.querySelectorAll('g'))].slice(0, 3).map(g => (g.getAttribute('transform') ?? '') + ' | ' + [...g.children].map(c => c.tagName + '(' + (c.getAttribute('transform') ?? c.getAttribute('d') ?? '').slice(0, 20) + ')').join(' '))
  if (svg === null) return []
  const matrix = svg.getScreenCTM()
  const cards = [...document.querySelectorAll('[data-mindmap-session]')].map(element => {
    const rect = element.getBoundingClientRect()
    return { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
  })
  const out = []
  for (const element of (svg === null ? [] : svg.querySelectorAll('path'))) {
    const transform = element.getAttribute('transform') ?? ''
    const translate = /translate\(([-\d.]+)[ ,]([-\d.]+)\)/.exec(transform)
    const rotate = /rotate\(([-\d.]+)\)/.exec(transform)
    if (translate === null) continue
    const point = matrix === null ? { x: Number(translate[1]), y: Number(translate[2]) }
      : new DOMPoint(Number(translate[1]), Number(translate[2])).matrixTransform(matrix)
    let nearest = null
    let best = Number.POSITIVE_INFINITY
    for (const card of cards) {
      const dx = Math.max(card.x - point.x, 0, point.x - (card.x + card.w))
      const dy = Math.max(card.y - point.y, 0, point.y - (card.y + card.h))
      const distance = Math.hypot(dx, dy)
      if (distance < best) { best = distance; nearest = card }
    }
    const angle = rotate === null ? 0 : Number(rotate[1])
    const radians = (angle * Math.PI) / 180
    const dir = { x: Math.cos(radians), y: Math.sin(radians) }
    let inward = null
    if (nearest !== null) {
      const edge = [
        { d: Math.abs(point.y - nearest.y), n: { x: 0, y: 1 } },
        { d: Math.abs(point.y - (nearest.y + nearest.h)), n: { x: 0, y: -1 } },
        { d: Math.abs(point.x - nearest.x), n: { x: 1, y: 0 } },
        { d: Math.abs(point.x - (nearest.x + nearest.w)), n: { x: -1, y: 0 } },
      ].sort((a, b) => a.d - b.d)[0]
      inward = Math.round((dir.x * edge.n.x + dir.y * edge.n.y) * 100) / 100
    }
    out.push({ x: Math.round(point.x), y: Math.round(point.y), angle, inward, gap: Math.round(best * 10) / 10 })
  }
  return { heads: out, tip, dump }
})

console.log(JSON.stringify(heads, null, 1))
const first = heads.tip !== null ? { x: heads.tip.x, y: heads.tip.y } : undefined
if (first !== undefined) {
  const head = first
  await page.screenshot({
    path: 'test/shots/arrow-look.png',
    clip: { x: Math.max(0, head.x - 70), y: Math.max(0, head.y - 50), width: 140, height: 100 },
  })
}
await browser.close()
child.kill()
