/**
 * The two connections the user reported as broken, rendered with the real component:
 *   A. two side-by-side cards, connected bottom → bottom
 *   B. two stacked cards, connected left → left
 * Both are drawn by MindMapEdge with exactly the props the canvas would give it.
 *
 *   node scripts/_two-cases.mjs [--shot name.png]
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const entry = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { MindMapEdge } from '../../src/client/MindMapEdge.tsx'

const CARD = { w: 224, h: 120 }
const GAP = 56

// A: side by side, bottom → bottom
const A = {
  from: { id: 'a1', x: 0, y: 0 },
  to: { id: 'a2', x: CARD.w + 48, y: 0 },
  fromHandle: 'b', toHandle: 'b',
}
// B: stacked, left → left
const B = {
  from: { id: 'b1', x: 0, y: 0 },
  to: { id: 'b2', x: 0, y: CARD.h + GAP },
  fromHandle: 'l', toHandle: 'l',
}

const anchor = (card, handle) => handle === 'r' ? { x: card.x + CARD.w, y: card.y + CARD.h / 2 }
  : handle === 'l' ? { x: card.x, y: card.y + CARD.h / 2 }
  : handle === 't' ? { x: card.x + CARD.w / 2, y: card.y }
  : { x: card.x + CARD.w / 2, y: card.y + CARD.h }
const clock = (handle) => handle === 'r' ? 'right' : handle === 'l' ? 'left' : handle === 't' ? 'top' : 'bottom'

function scene(spec, offsetX, offsetY) {
  const from = { ...spec.from, x: spec.from.x + offsetX, y: spec.from.y + offsetY }
  const to = { ...spec.to, x: spec.to.x + offsetX, y: spec.to.y + offsetY }
  const boxes = [from, to].map(card => ({ x: card.x, y: card.y, w: CARD.w, h: CARD.h }))
  const start = anchor(from, spec.fromHandle)
  const end = anchor(to, spec.toHandle)
  const props = {
    id: 'edge-' + from.id + '-' + to.id,
    source: from.id, target: to.id,
    sourceX: start.x, sourceY: start.y, targetX: end.x, targetY: end.y,
    sourcePosition: clock(spec.fromHandle), targetPosition: clock(spec.toHandle),
    sourceHandleId: spec.fromHandle, targetHandleId: spec.toHandle,
    selected: false, animated: false, interactionWidth: 18,
    type: 'mindMap', markerEnd: undefined,
    data: {
      sync: 'idle',
      obstacles: [],                       // only the two endpoints exist in this scene
      fromRect: boxes[0], toRect: boxes[1],
    },
  }
  return { cards: [from, to], props }
}

const a = scene(A, 40, 40)
const b = scene(B, 40, 260)

createRoot(document.getElementById('root')).render(
  <>
    <svg width={1200} height={900} style={{ position: 'absolute', inset: 0 }}>
      <MindMapEdge {...a.props} />
      <MindMapEdge {...b.props} />
    </svg>
    {[...a.cards, ...b.cards].map(card => (
      <div key={card.id} data-mindmap-session={card.id}
        style={{ position: 'absolute', left: card.x, top: card.y, width: CARD.w, height: CARD.h,
          boxSizing: 'border-box', background: '#23262d', border: '1px solid #333a45',
          borderRadius: 10, color: '#cfd6e3', fontSize: 11 }}>{card.id}</div>
    ))}
  </>,
)
`

fs.mkdirSync('test/shots', { recursive: true })
fs.writeFileSync('test/shots/two-entry.tsx', entry, 'utf8')
await build({
  entryPoints: ['test/shots/two-entry.tsx'],
  bundle: true,
  outfile: 'test/shots/two.js',
  format: 'iife',
  jsx: 'automatic',
  loader: { '.tsx': 'tsx', '.ts': 'ts' },
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'error',
})
fs.writeFileSync('test/shots/two.html', `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:#0d0f13;height:100%}</style>
<div id="root"></div><script src="./two.js"></script>`, 'utf8')

const EDGE_BIN = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
  .find(candidate => fs.existsSync(candidate))
const port = 9471
const child = spawn(EDGE_BIN, [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(os.tmpdir(), 'two-' + Date.now())}`,
  '--no-first-run', '--disable-extensions', '--window-size=1250,950', '--headless=new', 'about:blank'], { stdio: 'ignore' })

let ready = false
const started = Date.now()
while (Date.now() - started < 20000 && !ready) {
  try { ready = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok } catch { /* not up */ }
  if (!ready) await new Promise(resolve => setTimeout(resolve, 200))
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const page = browser.contexts()[0].pages()[0] ?? await browser.contexts()[0].newPage()
await page.setViewportSize({ width: 1250, height: 950 })
page.on('pageerror', error => console.log('PAGE ERROR:', String(error).slice(0, 200)))
await page.goto('file:///' + path.resolve('test/shots/two.html').replace(/\\/g, '/'))
await page.waitForTimeout(600)

const report = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('[data-mindmap-session]')].map(element => {
    const rect = element.getBoundingClientRect()
    return { id: element.getAttribute('data-mindmap-session'), x: rect.left, y: rect.top, w: rect.width, h: rect.height }
  })
  return [...document.querySelectorAll('svg path')].map(element => {
    const d = element.getAttribute('d') ?? ''
    if (d === '') return null
    const total = element.getTotalLength()
    let inside = 0
    const hits = new Set()
    for (let distance = 0; distance <= total; distance += 2) {
      const point = element.getPointAtLength(distance)
      for (const card of cards) {
        const nearStart = Math.hypot(point.x - cards[0].x, point.y - cards[0].y) < 0  // noop
        if (point.x > card.x + 1 && point.x < card.x + card.w - 1 && point.y > card.y + 1 && point.y < card.y + card.h - 1) {
          inside += 1
          hits.add(card.id)
        }
      }
    }
    return { d: d.slice(0, 120), inside, hits: [...hits] }
  }).filter(Boolean)
})

const shot = process.argv.includes('--shot') ? process.argv[process.argv.indexOf('--shot') + 1] : 'test/shots/two-cases.png'
await page.screenshot({ path: shot })
await browser.close()
child.kill()

console.log(JSON.stringify(report, null, 1))
