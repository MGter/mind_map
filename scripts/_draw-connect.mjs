/**
 * Draw the exact connection from the screenshot and look at it.
 *
 * Three stacked cards at their real coordinates (middle one is a painted 250×129),
 * and the connection the user drew — top card's bottom face → bottom card's top
 * face — fed to the real MindMapEdge component with exactly the props the canvas
 * would hand it. Rendered at scale 1, so the screenshot can be measured directly.
 *
 *   node scripts/_draw-connect.mjs [--shot name.png]
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const SCENE = {
  cards: [
    { id: 'top', x: 0, y: 0, w: 224, h: 120 },
    { id: 'mid', x: 4, y: 176, w: 250, h: 129 },
    { id: 'bottom', x: 0, y: 361, w: 224, h: 120 },
  ],
}

const entry = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { MindMapEdge } from '../../src/client/MindMapEdge.tsx'

const SCENE = ${JSON.stringify(SCENE)}
const top = SCENE.cards[0]
const mid = SCENE.cards[1]
const bottom = SCENE.cards[2]

const noObstacles = ${process.argv.includes('--no-obstacles')}
const obstacles = noObstacles ? [] : [{ x: mid.x, y: mid.y, w: mid.w, h: mid.h }]
const fromRect = { x: top.x, y: top.y, w: top.w, h: top.h }
const toRect = { x: bottom.x, y: bottom.y, w: bottom.w, h: bottom.h }

const edgeProps = {
  id: 'drawn',
  source: 'top',
  target: 'bottom',
  sourceX: top.x + top.w / 2,
  sourceY: top.y + top.h,
  targetX: bottom.x + bottom.w / 2,
  targetY: bottom.y,
  sourcePosition: 'bottom',
  targetPosition: 'top',
  sourceHandleId: null,
  targetHandleId: null,
  selected: false,
  animated: false,
  interactionWidth: 20,
  data: { sync: 'idle', obstacles, fromRect, toRect },
  type: 'mindMap',
  markerEnd: undefined,
}

createRoot(document.getElementById('root')).render(
  <>
    <svg width={1200} height={900} style={{ position: 'absolute', inset: 0 }}>
      <MindMapEdge {...edgeProps} />
    </svg>
    {SCENE.cards.map(card => (
      <div key={card.id} data-mindmap-session={card.id}
        style={{ position: 'absolute', left: card.x, top: card.y,
          width: card.w, height: card.h, boxSizing: 'border-box',
          background: '#23262d', border: '1px solid #333a45', borderRadius: 10, color: '#cfd6e3' }}>
        <span style={{ fontSize: 11 }}>{card.id}</span>
      </div>
    ))}
  </>,
)
`

fs.mkdirSync('test/shots', { recursive: true })
fs.writeFileSync('test/shots/draw-entry.tsx', entry, 'utf8')
await build({
  entryPoints: ['test/shots/draw-entry.tsx'],
  bundle: true,
  outfile: 'test/shots/draw.js',
  format: 'iife',
  jsx: 'automatic',
  loader: { '.tsx': 'tsx', '.ts': 'ts' },
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'error',
})
fs.writeFileSync('test/shots/draw.html', `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:#0d0f13;height:100%}</style>
<div id="root"></div><script src="./draw.js"></script>`, 'utf8')

const EDGE_BIN = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
  .find(candidate => fs.existsSync(candidate))
const port = 9451
const child = spawn(EDGE_BIN, [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(os.tmpdir(), 'draw-' + Date.now())}`,
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
await page.goto('file:///' + path.resolve('test/shots/draw.html').replace(/\\/g, '/'))
await page.waitForTimeout(700)

const report = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('[data-mindmap-session]')].map(element => {
    const rect = element.getBoundingClientRect()
    return { id: element.getAttribute('data-mindmap-session'), x: rect.left, y: rect.top, w: rect.width, h: rect.height }
  })
  const pathElement = document.querySelector('svg path')
  if (pathElement === null) return { cards, path: null }
  const total = pathElement.getTotalLength()
  const pointAt = distance => pathElement.getPointAtLength(distance)
  let inside = 0
  const hits = new Set()
  for (let distance = 0; distance <= total; distance += 2) {
    const point = pointAt(distance)
    for (const card of cards) {
      if (point.x > card.x + 1 && point.x < card.x + card.w - 1 && point.y > card.y + 1 && point.y < card.y + card.h - 1) {
        inside += 1
        hits.add(card.id)
      }
    }
  }
  return { cards, path: pathElement.getAttribute('d'), inside, hits: [...hits] }
})

const shot = process.argv.includes('--shot') ? process.argv[process.argv.indexOf('--shot') + 1] : 'test/shots/draw-connect.png'
await page.screenshot({ path: shot })
await browser.close()
child.kill()

console.log(JSON.stringify({
  cards: report.cards?.length,
  path: report.path,
  insideSamples: report.inside,
  hits: report.hits,
}, null, 1))
process.exitCode = (report.inside ?? 0) > 0 ? 1 : 0
