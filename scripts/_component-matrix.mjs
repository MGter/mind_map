/**
 * Component-level matrix: every connection layout, rendered by the real MindMapEdge.
 *
 * 16 face pairs × 5 arrangements (side by side, stacked, diagonal, one card between
 * horizontally, one card between vertically) = 80 scenes, all on one page at scale 1.
 * Each scene is measured on its own: the drawn path against the cards in that scene.
 *
 *   node scripts/_component-matrix.mjs [--shot name.png]
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const CARD = { w: 224, h: 120 }
const GAP_X = 48
const GAP_Y = 56
const FACES = ['r', 'l', 't', 'b']

/** Scene definitions: two endpoints plus any card that sits between them. */
const ARRANGEMENTS = [
  {
    name: 'side by side',
    cards: [
      { id: 'from', x: 0, y: 0 },
      { id: 'to', x: CARD.w + GAP_X, y: 0 },
    ],
  },
  {
    name: 'stacked',
    cards: [
      { id: 'from', x: 0, y: 0 },
      { id: 'to', x: 0, y: CARD.h + GAP_Y },
    ],
  },
  {
    name: 'diagonal',
    cards: [
      { id: 'from', x: 0, y: 0 },
      { id: 'to', x: CARD.w + GAP_X, y: CARD.h + GAP_Y },
    ],
  },
  {
    name: 'one between, horizontal',
    cards: [
      { id: 'from', x: 0, y: 0 },
      { id: 'mid', x: CARD.w + GAP_X, y: 0 },
      { id: 'to', x: 2 * (CARD.w + GAP_X), y: 0 },
    ],
  },
  {
    name: 'one between, vertical',
    cards: [
      { id: 'from', x: 0, y: 0 },
      { id: 'mid', x: 0, y: CARD.h + GAP_Y },
      { id: 'to', x: 0, y: 2 * (CARD.h + GAP_Y) },
    ],
  },
]

const ANCHOR = (card, face) => face === 'r' ? { x: card.x + CARD.w, y: card.y + CARD.h / 2 }
  : face === 'l' ? { x: card.x, y: card.y + CARD.h / 2 }
  : face === 't' ? { x: card.x + CARD.w / 2, y: card.y }
  : { x: card.x + CARD.w / 2, y: card.y + CARD.h }
const CLOCK = face => face === 'r' ? 'right' : face === 'l' ? 'left' : face === 't' ? 'top' : 'bottom'

const scenes = []
for (const arrangement of ARRANGEMENTS) {
  for (const fromFace of FACES) {
    for (const toFace of FACES) {
      const from = arrangement.cards.find(card => card.id === 'from')
      const to = arrangement.cards.find(card => card.id === 'to')
      const others = arrangement.cards.filter(card => card.id !== 'from' && card.id !== 'to')
      scenes.push({
        key: `${arrangement.name} · ${fromFace}→${toFace}`,
        cards: arrangement.cards.map(card => ({ ...card, w: CARD.w, h: CARD.h })),
        props: {
          sourceX: ANCHOR(from, fromFace).x,
          sourceY: ANCHOR(from, fromFace).y,
          targetX: ANCHOR(to, toFace).x,
          targetY: ANCHOR(to, toFace).y,
          sourcePosition: CLOCK(fromFace),
          targetPosition: CLOCK(toFace),
          fromRect: { x: from.x, y: from.y, w: CARD.w, h: CARD.h },
          toRect: { x: to.x, y: to.y, w: CARD.w, h: CARD.h },
          obstacles: others.map(card => ({ x: card.x, y: card.y, w: CARD.w, h: CARD.h })),
        },
      })
    }
  }
}

const entry = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { MindMapEdge } from '../../src/client/MindMapEdge.tsx'

const SCENES = ${JSON.stringify(scenes)}
const COLS = 6
const CELL_W = 900
const CELL_H = 460
const PAD = 40

createRoot(document.getElementById('root')).render(
  <div style={{ position: 'relative', width: COLS * CELL_W, height: Math.ceil(SCENES.length / COLS) * CELL_H }}>
    {SCENES.map((scene, index) => {
      const originX = (index % COLS) * CELL_W + PAD
      const originY = Math.floor(index / COLS) * CELL_H + PAD
      return (
        <div key={index} data-scene={index} data-target={scene.props.targetPosition} style={{ position: 'absolute', left: originX, top: originY,
          width: CELL_W - PAD, height: CELL_H - PAD, outline: '1px solid #1b1f26' }}>
          <div style={{ position: 'absolute', left: 0, top: -18, fontSize: 11, color: '#6b7280' }}>{scene.key}</div>
          <svg width={CELL_W} height={CELL_H} style={{ position: 'absolute', left: 0, top: 0 }}>
            <MindMapEdge
              id={'e' + index}
              source="from"
              target="to"
              sourceHandleId={null}
              targetHandleId={null}
              selected={false}
              animated={false}
              interactionWidth={18}
              type="mindMap"
              markerEnd={undefined}
              {...scene.props}
              data={{ sync: 'idle', obstacles: scene.props.obstacles,
                fromRect: scene.props.fromRect, toRect: scene.props.toRect }}
            />
          </svg>
          {scene.cards.map(card => (
            <div key={card.id} data-card-id={card.id}
              style={{ position: 'absolute', left: card.x, top: card.y, width: card.w, height: card.h,
                boxSizing: 'border-box', background: '#23262d', border: '1px solid #333a45',
                borderRadius: 10, color: '#cfd6e3', fontSize: 11 }}>{card.id}</div>
          ))}
        </div>
      )
    })}
  </div>,
)
`

fs.mkdirSync('test/shots', { recursive: true })
fs.writeFileSync('test/shots/cmatrix-entry.tsx', entry, 'utf8')
await build({
  entryPoints: ['test/shots/cmatrix-entry.tsx'],
  bundle: true,
  outfile: 'test/shots/cmatrix.js',
  format: 'iife',
  jsx: 'automatic',
  loader: { '.tsx': 'tsx', '.ts': 'ts' },
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'error',
})
fs.writeFileSync('test/shots/cmatrix.html', `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:#0d0f13}</style>
<div id="root"></div><script src="./cmatrix.js"></script>`, 'utf8')

const EDGE_BIN = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
  .find(candidate => fs.existsSync(candidate))
const port = 9481
const child = spawn(EDGE_BIN, [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(os.tmpdir(), 'cmatrix-' + Date.now())}`,
  '--no-first-run', '--disable-extensions', '--window-size=1500,1000', '--headless=new', 'about:blank'], { stdio: 'ignore' })

let ready = false
const started = Date.now()
while (Date.now() - started < 20000 && !ready) {
  try { ready = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok } catch { /* not up */ }
  if (!ready) await new Promise(resolve => setTimeout(resolve, 200))
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const page = browser.contexts()[0].pages()[0] ?? await browser.contexts()[0].newPage()
await page.setViewportSize({ width: 1500, height: 1000 })
page.on('pageerror', error => console.log('PAGE ERROR:', String(error).slice(0, 200)))
await page.goto('file:///' + path.resolve('test/shots/cmatrix.html').replace(/\\/g, '/'))
await page.waitForTimeout(1200)

const report = await page.evaluate(() => {
  const out = []
  for (const scene of document.querySelectorAll('[data-scene]')) {
    const key = scene.querySelector('div')?.textContent ?? ''
    const cards = [...scene.querySelectorAll('[data-card-id]')].map(element => {
      const rect = element.getBoundingClientRect()
      return { id: element.getAttribute('data-card-id'), x: rect.left, y: rect.top, w: rect.width, h: rect.height }
    })
    const pathElement = scene.querySelector('svg path')
    if (pathElement === null) { out.push({ key, error: 'no path' }); continue }
    const total = pathElement.getTotalLength()
    // Path points live in the SVG's own coordinate space; the cards are measured on
    // screen. Convert before comparing, or every scene looks shifted by the offset.
    const matrix = pathElement.getScreenCTM()
    const toScreen = point => (matrix === null ? point : point.matrixTransform(matrix))
    let inside = 0
    const hits = new Set()
    for (let distance = 0; distance <= total; distance += 2) {
      const point = toScreen(pathElement.getPointAtLength(distance))
      for (const card of cards) {
        if (point.x > card.x + 1 && point.x < card.x + card.w - 1 && point.y > card.y + 1 && point.y < card.y + card.h - 1) {
          inside += 1
          hits.add(card.id)
        }
      }
    }
      // The head is its own path; its rotate() must be the one the target face needs.
      const face = scene.getAttribute('data-target') ?? 'left'
      const expectedAngle = {"right":180,"left":0,"top":90,"bottom":-90}[face]
      const headElement = [...scene.querySelectorAll('svg path')].find(element => (element.getAttribute('d') ?? '').startsWith('M0 0'))
      const rotateMatch = /rotate\(([-\d.]+)\)/.exec(headElement === undefined ? '' : (headElement.getAttribute('transform') ?? ''))
      const arrowAngle = rotateMatch === null ? null : Number(rotateMatch[1])
      const arrowOk = expectedAngle === undefined || arrowAngle === expectedAngle
    out.push({ key, inside, hits: [...hits], face, arrowAngle, expectedAngle, arrowOk, d: pathElement.getAttribute('d')?.slice(0, 90) })
  }
  return out
})

const shot = process.argv.includes('--shot') ? process.argv[process.argv.indexOf('--shot') + 1] : 'test/shots/component-matrix.png'
await page.screenshot({ path: shot, fullPage: true })
await browser.close()
child.kill()

  const bad = report.filter(crossing => crossing.inside > 0 || crossing.arrowOk === false)
console.log(JSON.stringify({
  scenes: report.length,
  crossing: bad.length,
  sample: bad.slice(0, 6),
  arrows: report.slice(0, 6).map(entry => ({ face: entry.face, angle: entry.arrowAngle, expected: entry.expectedAngle, ok: entry.arrowOk })),
}, null, 1))
process.exitCode = bad.length === 0 ? 0 : 1
