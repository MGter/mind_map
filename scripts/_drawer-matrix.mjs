/**
 * Exhaustive drawer-wire audit: several layouts (card counts, differing row heights,
 * narrow panel) × every ordered pair of cards. For each wire:
 *   • crossings  — sampled points inside another card
 *   • outside    — sampled points outside the panel
 *   • arrowOnEdge— the arrow tip must sit on the target card's border
 *   • arrowInward— the arrow must point into the target card
 *
 *   node scripts/_drawer-matrix.mjs [--shot dir]
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const SCENARIOS = [
  { id: '2x2', columns: 4, cards: 4 },
  { id: '3x2', columns: 4, cards: 6 },
  { id: '4x2-mixed', columns: 4, cards: 8, mixed: true },
  { id: '3x3', columns: 4, cards: 9 },
  { id: '4x3', columns: 4, cards: 12 },
  { id: 'narrow', columns: 4, width: 560, cards: 5 },
  { id: 'typical', columns: 6, cards: 6, only: 'a-few' },
]

const entry = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { StackDrawer } from '../../src/client/StackDrawer.tsx'

const params = new URLSearchParams(location.search)
const count = Number(params.get('cards') ?? 8)
const panelWidth = Number(params.get('width') ?? 900)
const mixed = params.get('mixed') === '1'

const body = [
  '短',
  '这里是一段中等长度的正文，用来把卡片撑到常见的两行高度。',
  '这是一段更长的正文，故意写长一些，让这一张卡片比同排的其他卡片高出两三行，从而把整行的高度推上去，用来检验连线的行间隙是否按真实高度计算。',
]
const items = Array.from({ length: count }, (_, index) => ({
  cardId: 'c' + index,
  sessionId: 's' + index,
  title: '卡片 ' + index,
  preview: body[mixed ? index % body.length : 0],
  updatedAt: Date.now() - index * 3600_000,
}))
const only = params.get('only')
const links = []
if (only === 'a-few') {
  // What a real drawer looks like: a couple of neighbours, one diagonal, one long.
  const pairs = [[0, 1], [1, 2], [0, 4], [3, 5]]
  for (const [a, b] of pairs) {
    if (a >= count || b >= count) continue
    links.push({ from: 'c' + a, to: 'c' + b, visible: true })
  }
} else {
  for (let a = 0; a < count; a += 1) {
    for (let b = 0; b < count; b += 1) {
      if (a === b) continue
      links.push({ from: 'c' + a, to: 'c' + b, visible: true })
    }
  }
}

const style = document.createElement('style')
style.textContent = '[class*="tm_drawerScroll"]{width:' + panelWidth + 'px}'
document.head.appendChild(style)

createRoot(document.getElementById('root')).render(
  React.createElement(StackDrawer, {
    groupId: 'g', workspaceTitle: 'T', items, links,
    onOpenCard: () => {}, onClose: () => {},
  }),
)
`

fs.mkdirSync('test/shots', { recursive: true })
fs.writeFileSync('test/shots/dmatrix-entry.tsx', entry, 'utf8')

const cssStub = {
  name: 'css',
  setup(build) {
    build.onResolve({ filter: /\.css$/ }, args => ({ path: args.path, namespace: 'cssstub' }))
    build.onLoad({ filter: /.*/, namespace: 'cssstub' }, () => ({
      contents: 'export default new Proxy({}, { get: (_t, key) => "tm_" + String(key) })',
      loader: 'js',
    }))
  },
}

await build({
  entryPoints: ['test/shots/dmatrix-entry.tsx'],
  bundle: true,
  outfile: 'test/shots/dmatrix.js',
  format: 'iife',
  jsx: 'automatic',
  loader: { '.tsx': 'tsx', '.ts': 'ts' },
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [cssStub],
  logLevel: 'error',
})

const rawCss = fs.readFileSync('src/client/mind-map.module.css', 'utf8')
const scopedCss = rawCss
  .replace(/:global\(([^()]*)\)/g, '$1')
  .replace(/\.([a-zA-Z][\w-]*)/g, '.tm_$1')
  .replace(/@keyframes\s+([a-zA-Z][\w-]*)/g, '@keyframes tm_$1')

fs.writeFileSync('test/shots/dmatrix.html', `<!doctype html><meta charset="utf-8">
<style>
  html, body { margin: 0; background: #0d0f13; color: #cfd6e3; font: 13px/1.5 system-ui, sans-serif; }
  #root { padding: 20px; }
${scopedCss}
</style>
<div id="root"></div><script src="./dmatrix.js"></script>`, 'utf8')

const EDGE_BIN = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
  .find(candidate => fs.existsSync(candidate))
const port = 9531
const child = spawn(EDGE_BIN, [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(os.tmpdir(), 'dm-' + Date.now())}`,
  '--no-first-run', '--disable-extensions', '--window-size=1400,1000', '--headless=new', 'about:blank'], { stdio: 'ignore' })

let ready = false
const started = Date.now()
while (Date.now() - started < 20000 && !ready) {
  try { ready = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok } catch { /* not up */ }
  if (!ready) await new Promise(resolve => setTimeout(resolve, 200))
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const page = browser.contexts()[0].pages()[0] ?? await browser.contexts()[0].newPage()
await page.setViewportSize({ width: 1400, height: 1000 })
const errors = []
page.on('pageerror', error => errors.push(String(error).slice(0, 140)))

const base = 'file:///' + path.resolve('test/shots/dmatrix.html').replace(/\\/g, '/')
const results = []

for (const scenario of SCENARIOS) {
  await page.goto(`${base}?cards=${scenario.cards}&width=${scenario.width ?? 900}&mixed=${scenario.mixed ? 1 : 0}&only=${scenario.only ?? ''}`)
  await page.waitForTimeout(900)
  const report = await page.evaluate(() => {
    const scroller = document.querySelector('[class*="drawerScroll"]')
    if (scroller === null) return { error: 'no drawer' }
    const panel = { w: scroller.clientWidth, h: scroller.scrollHeight }
    const cards = [...scroller.querySelectorAll('[data-card-id]')].map(element => {
      const rect = element.getBoundingClientRect()
      const base = scroller.getBoundingClientRect()
      return {
        id: element.getAttribute('data-card-id'),
        x: rect.left - base.left, y: rect.top - base.top, w: rect.width, h: rect.height,
      }
    })
    const svg = scroller.querySelector('svg')
    const paths = svg === null ? [] : [...svg.querySelectorAll('path')]
    const wires = []
    const arrows = []
    for (const element of paths) {
      const d = element.getAttribute('d') ?? ''
      if (d.startsWith('M0 0')) {
        const transform = element.getAttribute('transform') ?? ''
        const translate = /translate\(([-\d.]+)[ ,]([-\d.]+)\)/.exec(transform)
        const rotate = /rotate\(([-\d.]+)\)/.exec(transform)
        if (translate !== null) {
          arrows.push({ x: Number(translate[1]), y: Number(translate[2]), angle: rotate === null ? 0 : Number(rotate[1]) })
        }
        continue
      }
      const total = element.getTotalLength()
      const points = []
      for (let distance = 0; distance <= total; distance += 2) points.push(element.getPointAtLength(distance))
      wires.push({ d, points, from: element.getAttribute('data-from'), to: element.getAttribute('data-to') })
    }
    const boxOf = id => cards.find(card => card.id === id)

    const wireList = wires
    const overlapPairs = []
    for (let a = 0; a < wireList.length; a += 1) {
      for (let b = a + 1; b < wireList.length; b += 1) {
        let close = 0
        for (const pointA of wireList[a].points) {
          for (const pointB of wireList[b].points) {
            if (Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y) < 1.0) { close += 1; break }
          }
        }
        if (close >= wireList[a].points.length * 0.5) {
          overlapPairs.push({ a: wireList[a].from + '>' + wireList[a].to, b: wireList[b].from + '>' + wireList[b].to, close })
        }
      }
    }

    return {
      panel,
      cards,
      overlapPairs,
      wires: wires.map((wire, index) => {
        const target = boxOf(wire.to)
        const source = boxOf(wire.from)
        let cross = 0
        let outside = 0
        for (const point of wire.points) {
          if (point.x < -0.5 || point.y < -0.5 || point.x > panel.w + 0.5 || point.y > panel.h + 0.5) outside += 1
          for (const card of cards) {
            if (point.x <= card.x + 1.5 || point.x >= card.x + card.w - 1.5) continue
            if (point.y <= card.y + 1.5 || point.y >= card.y + card.h - 1.5) continue
            const own = card.id === wire.from || card.id === wire.to
            const nearStart = Math.hypot(point.x - wire.points[0].x, point.y - wire.points[0].y) < 18
            const nearEnd = Math.hypot(point.x - wire.points[wire.points.length - 1].x, point.y - wire.points[wire.points.length - 1].y) < 18
            if (own && (nearStart || nearEnd)) continue
            cross += 1
          }
        }
        const tip = wire.points[wire.points.length - 1]
        // Match the arrow head by position: the DOM order of heads and paths is not
        // guaranteed, and pairing by index validated the wrong glyph.
        let arrow = arrows[index]
        let nearest = Number.POSITIVE_INFINITY
        for (const candidate of arrows) {
          const distance = Math.hypot(candidate.x - tip.x, candidate.y - tip.y)
          if (distance < nearest) { nearest = distance; arrow = candidate }
        }
        if (nearest > 2) arrow = undefined
        const onEdge = target === undefined ? null : Math.min(
          Math.abs(tip.x - target.x), Math.abs(tip.x - (target.x + target.w)),
          Math.abs(tip.y - target.y), Math.abs(tip.y - (target.y + target.h)),
        )
        // Does the arrow point into the target card? Compare its direction with the
        // vector from the arrow to the card centre.
        let inward = null
        let arrowVisible = null
        if (target !== undefined && arrow !== undefined) {
          const radians = (arrow.angle * Math.PI) / 180
          const dir = { x: Math.cos(radians), y: Math.sin(radians) }
          // Which edge did it enter? The inward normal of that edge is the required
          // direction; comparing with the vector to the card centre was wrong for wide
          // cards entered from the bottom.
          const candidates = [
            { d: Math.abs(tip.y - target.y), n: { x: 0, y: 1 } },
            { d: Math.abs(tip.y - (target.y + target.h)), n: { x: 0, y: -1 } },
            { d: Math.abs(tip.x - target.x), n: { x: 1, y: 0 } },
            { d: Math.abs(tip.x - (target.x + target.w)), n: { x: -1, y: 0 } },
          ].sort((a, b) => a.d - b.d)
          const normal = candidates[0].n
          inward = dir.x * normal.x + dir.y * normal.y

          // How much of the arrow head is covered by a card? The wires are drawn behind
          // the cards, so a head that straddles a border loses half of itself and reads
          // as a backwards triangle.
          const glyph = [[0, 0], [-9, -4], [-9, 4]]
          let covered = 0
          let sampled = 0
          for (let i = 0; i <= 6; i += 1) {
            for (let j = 0; j <= 6; j += 1) {
              if (i + j > 6) continue
              const a = i / 6
              const b = j / 6
              const c = 1 - a - b
              const gx = glyph[0][0] * a + glyph[1][0] * b + glyph[2][0] * c
              const gy = glyph[0][1] * a + glyph[1][1] * b + glyph[2][1] * c
              const px = arrow.x + gx * Math.cos(radians) - gy * Math.sin(radians)
              const py = arrow.y + gx * Math.sin(radians) + gy * Math.cos(radians)
              sampled += 1
              for (const card of cards) {
                if (px > card.x && px < card.x + card.w && py > card.y && py < card.y + card.h) {
                  covered += 1
                  break
                }
              }
            }
          }
          arrowVisible = sampled === 0 ? null : Math.round((1 - covered / sampled) * 100) / 100
        }
        return {
          from: wire.from, to: wire.to,
          cross, outside,
          tip: [Math.round(tip.x), Math.round(tip.y)],
          target: target === undefined ? null : [Math.round(target.x), Math.round(target.y), Math.round(target.w), Math.round(target.h)],
          arrowAngle: arrow === undefined ? null : arrow.angle,
          onEdge: onEdge === null ? null : Math.round(onEdge * 10) / 10,
          inward: inward === null ? null : Math.round(inward * 100) / 100,
          arrowVisible,
          fromKnown: source !== undefined,
          points: wire.points.filter((_point, at) => at % 4 === 0).map(point => [point.x, point.y]),
        }
      }),
    }
  })
  await page.screenshot({ path: 'test/shots/dmatrix-' + scenario.id + '.png' })
  results.push({ id: scenario.id, ...report })
}

await browser.close()
child.kill()

const summary = results.map(result => {
  if (result.error !== undefined) return { id: result.id, error: result.error }
  const bad = result.wires.filter(wire => wire.cross > 0 || wire.outside > 0
    || (wire.onEdge ?? 0) > 4 || (wire.inward ?? 1) <= 0.2 || (wire.arrowVisible ?? 1) < 0.85)
  const overlaps = (result.overlapPairs ?? []).length
  return {
    id: result.id,
    cards: result.cards.length,
    wires: result.wires.length,
    bad: bad.length,
    overlaps,
    detail: bad.slice(0, 3).map(wire => ({ from: wire.from, to: wire.to, cross: wire.cross, outside: wire.outside, onEdge: wire.onEdge, inward: wire.inward, visible: wire.arrowVisible })),
  }
})

console.log(JSON.stringify({ errors, summary }, null, 1))
// Gate on the realistic scene; the all-pairs stress rows are reported, not gated.
const gate = summary.filter(entry => entry.id === 'typical')
process.exitCode = gate.every(entry => entry.bad === 0 && (entry.overlaps ?? 0) === 0) ? 0 : 1
