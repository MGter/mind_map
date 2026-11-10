/**
 * Render the REAL board (all frames, real slot positions) with the real edge
 * component in headless Edge, then measure the *rendered* SVG paths against the
 * *rendered* card boxes. This is the same picture the app draws, so if a line
 * crosses a card here, it reproduces the report.
 *
 *   node scripts/_board-sim.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { CARD_W, CARD_H, layoutFor } from '../src/client/grid-layout.ts'

const raw = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.dsh', 'storages', 'mind_map.json'), 'utf8'))
const cards = Object.entries(raw.tables.cards).map(([id, c]) => ({ id, x: c.x, y: c.y }))
const frames = raw.global?.wsFrames ?? {}

const placed = {}
const frameOf = {}
for (const [wsId, stored] of Object.entries(frames)) {
  const rect = { x: stored.x, y: stored.y, width: stored.width, height: stored.height }
  const inside = cards.filter(c => c.x + CARD_W / 2 > rect.x && c.x + CARD_W / 2 < rect.x + rect.width
    && c.y + CARD_H / 2 > rect.y && c.y + CARD_H / 2 < rect.y + rect.height)
  inside.sort((a, b) => (a.y - b.y) || (a.x - b.x) || a.id.localeCompare(b.id))
  Object.assign(placed, layoutFor(rect, inside.map(c => c.id)))
  for (const card of inside) frameOf[card.id] = wsId
}
for (const card of cards) if (placed[card.id] === undefined) placed[card.id] = { x: card.x, y: card.y }

// every card in the biggest frame, all pairs — the case the user keeps hitting
const groups = new Map()
for (const card of cards) {
  const ws = frameOf[card.id] ?? 'none'
  if (!groups.has(ws)) groups.set(ws, [])
  groups.get(ws).push(card.id)
}
// Pick the frame whose cards form the tightest cluster: that is the one a screenshot
// can show at a readable zoom (a sprawling frame would fitView down to nothing).
const spanOf = ids => {
  const xs = ids.map(id => placed[id].x)
  const ys = ids.map(id => placed[id].y)
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))
}
const biggest = [...groups.entries()]
  .filter(([ws, ids]) => ws !== 'none' && ids.length >= 4)
  .sort((a, b) => spanOf(a[1]) - spanOf(b[1]))[0]
// (focus mode below uses biggest[1])

// Focus mode: render only the chosen frame's cards so the screenshot is readable.
const FOCUS = process.argv.includes('--focus')
const focusIds = new Set(biggest[1])
const visible = FOCUS ? cards.filter(card => focusIds.has(card.id)) : cards
const scene = {
  nodes: visible.map(card => ({ id: card.id, x: placed[card.id].x, y: placed[card.id].y })),
  pairs: [],
}
const ids = biggest[1].slice(0, 6)
for (let i = 0; i < ids.length; i += 1) {
  for (let j = i + 1; j < ids.length; j += 1) scene.pairs.push([ids[i], ids[j]])
}
// long cross-frame lines too (the kind that kept crossing)
const otherFrames = [...groups.entries()].filter(([ws]) => ws !== 'none' && ws !== biggest[0])
for (let index = 0; index < (FOCUS ? 0 : 8) && index < otherFrames.length; index += 1) {
  scene.pairs.push([ids[0], otherFrames[index][1][0]])
}
console.log('frame', biggest[0], 'cards', ids.length, 'pairs', scene.pairs.length)

const entry = `
import { createRoot } from 'react-dom/client'
import { ReactFlow, ReactFlowProvider, Background, Handle, Position, ConnectionMode } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { edgeTypes } from '../../src/client/MindMapEdge.tsx'
import { pickFaces } from '../../src/client/edge-routing.ts'

const CARD_W = 224
const CARD_H = 120
const scene = ${JSON.stringify(scene)}

const nodeTypes = {
  card: ({ data }) => (
    <div data-card-id={data.id} data-mindmap-session={data.id} style={{ width: CARD_W, height: CARD_H, background: '#23262d', color: '#cfd6e3',
      border: '1px solid #333a45', borderRadius: 10 }}>
      <Handle id="t" type="source" position={Position.Top} />
      <Handle id="r" type="source" position={Position.Right} />
      <Handle id="b" type="source" position={Position.Bottom} />
      <Handle id="l" type="source" position={Position.Left} />
      <span style={{ fontSize: 11 }}>{data.id.slice(-4)}</span>
    </div>
  ),
}

const placed = scene.nodes
const rectOf = id => { const p = placed.find(n => n.id === id); return { x: p.x, y: p.y, w: CARD_W, h: CARD_H } }

const nodes = scene.nodes.map(n => ({
  id: n.id, type: 'card', position: { x: n.x, y: n.y }, data: { id: n.id },
  style: { width: CARD_W, height: CARD_H },
}))

const edges = scene.pairs.map(([from, to], index) => {
  const faces = pickFaces({ id: from, x: rectOf(from).x, y: rectOf(from).y },
    { id: to, x: rectOf(to).x, y: rectOf(to).y },
    placed.map(n => ({ id: n.id, x: n.x, y: n.y })), { cardWidth: CARD_W, cardHeight: CARD_H })
  return {
    id: 'e' + index, source: from, target: to, type: 'mindMap',
    sourceHandle: faces.fromHandle, targetHandle: faces.toHandle,
    data: {
      sync: 'idle',
      // deliberately empty: the renderer must fall back to measuring the DOM
      obstacles: [],
      fromRect: rectOf(from), toRect: rectOf(to),
    },
  }
})

createRoot(document.getElementById('root')).render(
  <ReactFlowProvider>
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
      connectionMode={ConnectionMode.Loose} fitView>
      <Background />
    </ReactFlow>
  </ReactFlowProvider>,
)
`

fs.mkdirSync('test/shots', { recursive: true })
fs.writeFileSync('test/shots/board-sim-entry.tsx', entry, 'utf8')
await build({
  entryPoints: ['test/shots/board-sim-entry.tsx'],
  bundle: true,
  outfile: 'test/shots/board-sim.js',
  format: 'iife',
  jsx: 'automatic',
  loader: { '.tsx': 'tsx', '.ts': 'ts' },
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'error',
})
fs.writeFileSync('test/shots/board-sim.html', `<!doctype html><meta charset="utf-8">
<style>html,body,#root{width:100%;height:100%;margin:0;background:#16181d}</style>
<div id="root"></div><script>window.__SCENE__ = ${JSON.stringify(scene)};</script><script src="./board-sim.js"></script>`, 'utf8')

const EDGE_BIN = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
  .find(candidate => fs.existsSync(candidate))
const profile = path.join(os.tmpdir(), 'board-sim-profile')
fs.rmSync(profile, { recursive: true, force: true })
const CDP = 9388
const child = spawn(EDGE_BIN, [`--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-extensions', '--window-size=1600,1000', '--headless=new', 'about:blank'], { stdio: 'ignore' })

const deadline = Date.now() + 20000
let ready = false
while (Date.now() < deadline && !ready) {
  try { ready = (await fetch(`http://127.0.0.1:${CDP}/json/version`)).ok } catch { }
  if (!ready) await new Promise(r => setTimeout(r, 250))
}
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP}`)
const page = browser.contexts()[0].pages()[0]
await page.setViewportSize({ width: 1600, height: 1000 })
await page.goto('file:///' + path.resolve('test/shots/board-sim.html').replace(/\\/g, '/'))
await page.waitForTimeout(1200)
page.on('console', message => { if (message.type() === 'error') console.log('PAGE ERROR:', message.text().slice(0, 300)) })
page.on('pageerror', error => console.log('PAGE EXCEPTION:', String(error).slice(0, 300)))

const report = await page.evaluate(() => {
  // Measure in FLOW coordinates on both sides: path points are flow units and the
  // scene boxes are flow units, so no viewport transform can skew the result.
  const cards = (window.__SCENE__?.nodes ?? []).map(node => ({ id: node.id, x: node.x, y: node.y, w: 224, h: 120 }))
  const pairs = window.__SCENE__?.pairs ?? []
  const groups = [...document.querySelectorAll('.react-flow__edge')]
  const out = []
  for (const group of groups) {
    const el = group.querySelector('.react-flow__edge-path')
    if (el === null) continue
    const index = Number(String(group.getAttribute('data-id') ?? 'e0').replace('e', '')) || 0
    const own = new Set(pairs[index] ?? [])
    const total = el.getTotalLength()
    let inside = 0
    let worst = Infinity
    for (let d = 0; d <= total; d += 2) {
      const p = el.getPointAtLength(d)
      for (const card of cards) {
        // the two endpoint cards are supposed to be touched at the anchors
        if (own.has(card.id)) continue
        const dx = Math.max(card.x - p.x, 0, p.x - (card.x + card.w))
        const dy = Math.max(card.y - p.y, 0, p.y - (card.y + card.h))
        const dist = Math.hypot(dx, dy)
        if (dist < worst) worst = dist
        if (dist === 0) inside += 1
      }
    }
    out.push({ id: group.getAttribute('data-id'), pair: pairs[index], d: el.getAttribute('d').slice(0, 80), inside, closest: Math.round(worst * 10) / 10 })
  }
  return { debug: (window.__edgeDebug ?? []).slice(0, 1).map(d => ({ id: d.id, merged: d.merged, measured: d.measured, first: d.measuredFirst, from: d.fromRect, to: d.toRect })), cards: cards.length, sessionEls: document.querySelectorAll('[data-mindmap-session]').length, viewport: !!document.querySelector('.react-flow__viewport'), transform: getComputedStyle(document.querySelector('.react-flow__viewport')).transform, paths: out }
})
await page.screenshot({ path: FOCUS ? 'test/shots/board-sim-focus.png' : 'test/shots/board-sim.png', fullPage: true })
await browser.close()
child.kill()

const bad = report.paths.filter(entry => entry.inside > 0)
console.log('EDGES', JSON.stringify(report.paths.map(e => ({ id: e.id, inside: e.inside, d: e.d.slice(0, 70) })), null, 1))
console.log('META', JSON.stringify({ sessionEls: report.sessionEls, transform: report.transform, debug: report.debug }))
console.log(JSON.stringify({ cards: report.cards, edges: report.paths.length, crossing: bad.length,
  worst: Math.min(...report.paths.map(entry => entry.closest)), sample: bad.slice(0, 3) }, null, 1))
