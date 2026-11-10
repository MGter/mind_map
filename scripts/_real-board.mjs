/**
 * Render the REAL board (frames + slot positions from mind_map.json) with the real
 * edge component in headless Edge, then measure the *rendered* SVG paths against the
 * *rendered* card boxes in screen space (getScreenCTM / getBoundingClientRect).
 *
 *   node scripts/_real-board.mjs [--all] [--shot name.png]
 *
 * --all   connect every pair inside the two biggest frames (slower, wider coverage)
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { CARD_W, CARD_H, layoutFor } from '../src/client/grid-layout.ts'

const raw = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.dsh', 'storages', 'mind_map.json'), 'utf8'))
const cards = Object.entries(raw.tables.cards).map(([id, card]) => ({ id, x: card.x, y: card.y }))
const frames = raw.global?.wsFrames ?? {}

// slot positions exactly like the canvas computes them
const placed = {}
const byFrame = new Map()
for (const [wsId, stored] of Object.entries(frames)) {
  const rect = { x: stored.x, y: stored.y, width: stored.width, height: stored.height }
  const inside = cards.filter(card => card.x + CARD_W / 2 > rect.x && card.x + CARD_W / 2 < rect.x + rect.width
    && card.y + CARD_H / 2 > rect.y && card.y + CARD_H / 2 < rect.y + rect.height)
  inside.sort((a, b) => (a.y - b.y) || (a.x - b.x) || a.id.localeCompare(b.id))
  Object.assign(placed, layoutFor(rect, inside.map(card => card.id)))
  byFrame.set(wsId, inside.map(card => card.id))
}
for (const card of cards) if (placed[card.id] === undefined) placed[card.id] = { x: card.x, y: card.y }

// pairs: everything inside the two biggest frames, plus a few cross-frame lines
const framesBySize = [...byFrame.entries()].sort((a, b) => b[1].length - a[1].length)
const pairs = []
const addPairs = ids => {
  const limit = process.argv.includes('--all') ? ids.length : Math.min(ids.length, 6)
  for (let i = 0; i < limit; i += 1) {
    for (let j = i + 1; j < limit; j += 1) pairs.push([ids[i], ids[j]])
  }
}
addPairs(framesBySize[0]?.[1] ?? [])
addPairs(framesBySize[1]?.[1] ?? [])
for (const [, ids] of framesBySize.slice(2, 6)) {
  if (ids[0] !== undefined) pairs.push([framesBySize[0][1][0], ids[0]])
}

const scene = {
  // every card on the board is rendered, so the obstacle set is complete — a scene
  // that only contained the pair endpoints made the measured routes meaningless.
  nodes: cards.map(card => ({ id: card.id, x: placed[card.id].x, y: placed[card.id].y })),
  pairs,
}

const entry = `
import React from 'react'
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
    <div data-mindmap-session={data.id} style={{ width: CARD_W, height: CARD_H, boxSizing: 'content-box', padding: '10px 12px', border: '1px solid #333a45', background: '#23262d',
      color: '#cfd6e3', border: '1px solid #333a45', borderRadius: 10 }}>
      <Handle id="t" type="source" position={Position.Top} />
      <Handle id="r" type="source" position={Position.Right} />
      <Handle id="b" type="source" position={Position.Bottom} />
      <Handle id="l" type="source" position={Position.Left} />
    </div>
  ),
}

const placed = scene.nodes
const rectOf = id => { const p = placed.find(n => n.id === id); return { x: p.x, y: p.y, w: CARD_W, h: CARD_H } }
const nodes = scene.nodes.map(n => ({ id: n.id, type: 'card', position: { x: n.x, y: n.y }, data: { id: n.id } }))
const edges = scene.pairs.map(([from, to], index) => {
  const faces = pickFaces({ id: from, x: rectOf(from).x, y: rectOf(from).y },
    { id: to, x: rectOf(to).x, y: rectOf(to).y },
    placed.map(n => ({ id: n.id, x: n.x, y: n.y })), { cardWidth: CARD_W, cardHeight: CARD_H })
  return {
    id: 'e' + index, source: from, target: to, type: 'mindMap',
    sourceHandle: faces.fromHandle, targetHandle: faces.toHandle,
    data: {
      sync: 'idle',
      // the painted card is content-box: 224+24+2 wide, 120 bounded below by content\n      obstacles: placed.filter(n => n.id !== from && n.id !== to).map(n => ({ x: n.x, y: n.y, w: CARD_W + 26, h: CARD_H + 9 })),
      fromRect: { ...rectOf(from), w: CARD_W + 26, h: CARD_H + 9 }, toRect: { ...rectOf(to), w: CARD_W + 26, h: CARD_H + 9 },
    },
  }
})

function App() {
  const [, setTick] = React.useState(0)
  React.useEffect(() => { const id = setTimeout(() => setTick(v => v + 1), 300); return () => clearTimeout(id) }, [])
  return (
    <ReactFlowProvider>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Loose} fitView>
        <Background />
      </ReactFlow>
    </ReactFlowProvider>
  )
}
createRoot(document.getElementById('root')).render(<App />)
`

fs.mkdirSync('test/shots', { recursive: true })
fs.writeFileSync('test/shots/real-board-entry.tsx', entry, 'utf8')
await build({
  entryPoints: ['test/shots/real-board-entry.tsx'],
  bundle: true,
  outfile: 'test/shots/real-board.js',
  format: 'iife',
  jsx: 'automatic',
  loader: { '.tsx': 'tsx', '.ts': 'ts' },
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'error',
})
fs.writeFileSync('test/shots/real-board.html', `<!doctype html><meta charset="utf-8">
<style>html,body,#root{width:100%;height:100%;margin:0;background:#16181d}</style>
<div id="root"></div><script src="./real-board.js"></script>`, 'utf8')

const EDGE_BIN = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
  .find(candidate => fs.existsSync(candidate))
const port = 9421
const child = spawn(EDGE_BIN, [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(os.tmpdir(), 'real-board-' + Date.now())}`,
  '--no-first-run', '--disable-extensions', '--window-size=1800,1100', '--headless=new', 'about:blank'], { stdio: 'ignore' })

let ready = false
const started = Date.now()
while (Date.now() - started < 20000 && !ready) {
  try { ready = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok } catch { /* not up */ }
  if (!ready) await new Promise(resolve => setTimeout(resolve, 200))
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const page = browser.contexts()[0].pages()[0] ?? await browser.contexts()[0].newPage()
await page.setViewportSize({ width: 1800, height: 1100 })
await page.goto('file:///' + path.resolve('test/shots/real-board.html').replace(/\\/g, '/'))
await page.waitForTimeout(2000)

const report = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('[data-mindmap-session]')].map(element => {
    const rect = element.getBoundingClientRect()
    return { id: element.getAttribute('data-mindmap-session'), x: rect.left, y: rect.top, w: rect.width, h: rect.height }
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
    const own = new Set()
    cards.forEach((card, index) => {
      for (const point of [pointAt(0), pointAt(total)]) {
        if (point.x > card.x - 6 && point.x < card.x + card.w + 6 && point.y > card.y - 6 && point.y < card.y + card.h + 6) own.add(index)
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
    const hits = new Set()
    for (let distance = 0; distance <= total; distance += 4) {
      const point = pointAt(distance)
      cards.forEach((card, index) => {
        if (own.has(index)) return
        if (point.x > card.x && point.x < card.x + card.w && point.y > card.y && point.y < card.y + card.h) hits.add(String(card.id).slice(-6))
      })
    }
    out.push({ id: group.getAttribute('data-id'), inside, closest: Math.round(closest * 10) / 10, hits: [...hits].slice(0, 4), d: element.getAttribute('d').slice(0, 90) })
  }
  return { cards: cards.length, edges: out }
})

const shot = process.argv.includes('--shot') ? process.argv[process.argv.indexOf('--shot') + 1] : 'test/shots/real-board.png'
await page.screenshot({ path: shot, fullPage: false })
await browser.close()
child.kill()

const crossing = report.edges.filter(edge => edge.inside > 0)
console.log(JSON.stringify({
  cards: report.cards,
  edges: report.edges.length,
  crossing: crossing.length,
  worstClearance: Math.min(...report.edges.map(edge => edge.closest)),
  detail: crossing.slice(0, 5),
}, null, 1))
process.exitCode = crossing.length === 0 ? 0 : 1
