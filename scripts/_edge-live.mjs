/**
 * Mount the real MindMapEdge inside a real React Flow, bundle it, and screenshot
 * it — the only way to prove the component paints (the probe's fixture edge sits
 * on folded cards, so it is filtered out before render).
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const entry = `import { createRoot } from 'react-dom/client'
import { ReactFlow, ReactFlowProvider, Background, Handle, Position, ConnectionMode } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { edgeTypes } from '../src/client/MindMapEdge.tsx'
import { pickFaces } from '../src/client/edge-routing.ts'
import { routeBetween } from '../src/client/edge-route.ts'

const CARD_W = 224
const CARD_H = 120
const card = (id, x, y, label) => ({ id, position: { x, y }, data: { label },
  style: { width: CARD_W, height: CARD_H, background: '#23262d', color: '#cfd6e3', border: '1px solid #333a45', borderRadius: 10 } })

// The map's cards expose four handles named t/r/b/l; the rig must too, otherwise
// an edge that asks for handle 'r' cannot be drawn at all.
const nodeTypes = {
  card: ({ data }) => (
    <div style={{ width: CARD_W, height: CARD_H, background: '#23262d', color: '#cfd6e3',
      border: '1px solid #333a45', borderRadius: 10, display: 'flex',
      alignItems: 'center', justifyContent: 'center' }}>
      <Handle id="t" type="source" position={Position.Top} />
      <Handle id="r" type="source" position={Position.Right} />
      <Handle id="b" type="source" position={Position.Bottom} />
      <Handle id="l" type="source" position={Position.Left} />
      {data.label}
    </div>
  ),
}

// b: far to the right-down (long line) — c/d: neighbours 12px apart (the stub case)
const nodes = [
  { ...card('a', 40, 30, 'A'), type: 'card' },
  { ...card('b', 520, 210, 'B'), type: 'card' },
  { ...card('c', 40, 290, 'C'), type: 'card' },
  { ...card('d', 40 + CARD_W + 12, 290, 'D'), type: 'card' },
]

const placed = nodes.map(node => ({ id: node.id, x: node.position.x, y: node.position.y }))
const faceFor = (fromId, toId) => {
  const from = placed.find(node => node.id === fromId)
  const to = placed.find(node => node.id === toId)
  const faces = pickFaces(from, to, placed, { cardWidth: CARD_W, cardHeight: CARD_H })
  return { sourceHandle: faces.fromHandle, targetHandle: faces.toHandle }
}

// A card parked right between A and B: the line must route around it, through
// the middle of the gap, instead of cutting across the card body.
const blocker = { ...card('w', 296, 96, 'W'), type: 'card' }
const allNodes = [...nodes, blocker]
const allPlaced = allNodes.map(node => ({ id: node.id, x: node.position.x, y: node.position.y }))
const rectOf = id => {
  const item = allPlaced.find(entry => entry.id === id)
  return { x: item.x, y: item.y, w: CARD_W, h: CARD_H }
}
const obstaclesFor = (fromId, toId) => allPlaced
  .filter(entry => entry.id !== fromId && entry.id !== toId)
  .map(entry => ({ x: entry.x, y: entry.y, w: CARD_W, h: CARD_H }))

// The app hands the renderer the two endpoint boxes as well, so the router can
// exclude them from the obstacles (that is what makes routing work at all).
const dataFor = (fromId, toId, sync) => ({
  sync,
  obstacles: obstaclesFor(fromId, toId),
  fromRect: rectOf(fromId),
  toRect: rectOf(toId),
})

const edges = [
  { id: 'sync', source: 'a', target: 'b', type: 'mindMap', data: dataFor('a', 'b', 'synced'), ...faceFor('a', 'b') },
  { id: 'idle', source: 'a', target: 'b', type: 'mindMap', data: dataFor('a', 'b', 'idle'), ...faceFor('a', 'b') },
  { id: 'adjacent', source: 'c', target: 'd', type: 'mindMap', data: dataFor('c', 'd', 'synced'), ...faceFor('c', 'd') },
]

createRoot(document.getElementById('root')!).render(
  <div style={{ width: 820, height: 560 }}>
    <ReactFlowProvider>
      <ReactFlow nodes={allNodes} edges={edges} edgeTypes={edgeTypes} nodeTypes={nodeTypes} connectionMode={ConnectionMode.Loose} fitView proOptions={{ hideAttribution: true }}>
        <Background />
      </ReactFlow>
    </ReactFlowProvider>
  </div>,
)
`
const entryFile = path.join('scripts', '_edge-live-entry.tsx')
fs.writeFileSync(entryFile, entry, 'utf8')

const outDir = path.join('test', 'shots')
fs.mkdirSync(outDir, { recursive: true })
const bundleFile = path.join(outDir, 'edge-live.js')

import * as esbuild from 'esbuild'
await esbuild.build({
  entryPoints: [entryFile],
  bundle: true,
  jsx: 'automatic',
  format: 'iife',
  outfile: bundleFile,
  loader: { '.tsx': 'tsx' },
  logLevel: 'warning',
})
if (!fs.existsSync(bundleFile)) {
  console.error('bundle failed')
  process.exit(1)
}
const html = `<!doctype html>
<meta charset="utf-8" />
<style>
  body { margin: 0; background: #16181d; font-family: system-ui, sans-serif; }
  .react-flow { background: #16181d; }
  .react-flow__node { display: flex; align-items: center; justify-content: center; font-size: 13px; }
</style>
<div id="root"></div>
<link rel="stylesheet" href="edge-live.css" />
<script src="edge-live.js"></script>
`

const pageFile = path.join(outDir, 'edge-live.html')
fs.writeFileSync(pageFile, html, 'utf8')

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(candidate => fs.existsSync(candidate))
const profileDir = path.join(os.tmpdir(), 'mindmap-edge-live')
fs.rmSync(profileDir, { recursive: true, force: true })
const CDP = 9361
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${profileDir}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--window-size=800,460', '--headless=new', 'about:blank',
], { stdio: 'ignore' })

async function waitForCdp(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP}/json/version`)
      if (response.ok) return await response.json()
    } catch { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('no CDP')
}

await waitForCdp()
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP}`)
const context = browser.contexts()[0] ?? await browser.newContext()
const page = context.pages()[0] ?? await context.newPage()
page.on('pageerror', error => console.log('PAGEERROR', String(error)))
page.on('console', message => {
  if (message.type() === 'error') console.log('CONSOLE', message.text().slice(0, 200))
})
await page.setViewportSize({ width: 800, height: 460 })
await page.goto('file:///' + path.resolve(pageFile).replace(/\\/g, '/'))
await page.waitForTimeout(1200)

const shape = await page.evaluate(() => {
  const groups = [...document.querySelectorAll('.react-flow__edge')]
  return {
    edges: groups.length,
    withMask: groups.filter(group => group.querySelector('mask') !== null).length,
      circles: document.querySelectorAll('.react-flow__edge circle').length,
      maskRects: [...document.querySelectorAll('.react-flow__edge mask rect')].map(r => Number(r.getAttribute('width'))).slice(0,4),
    paths: document.querySelectorAll('.react-flow__edge path').length,
  }
})
console.log('shape:', JSON.stringify(shape))

// Geometry of each edge: proves the adjacent pair really loops (not a stub).
const geometry = await page.evaluate(() => {
  return [...document.querySelectorAll('.react-flow__edge')].map(group => {
    const path = group.querySelector('path.react-flow__edge-path')
    const box = path === null ? null : path.getBBox()
    return {
      id: group.getAttribute('data-id') ?? group.getAttribute('data-testid') ?? '?',
      length: path === null ? 0 : Math.round(path.getTotalLength()),
      box: box === null ? null : { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) },
    }
  })
})
console.log('geometry:', JSON.stringify(geometry))

for (const [index, delay] of [0, 900, 900].entries()) {
  if (delay > 0) await page.waitForTimeout(delay)
  const file = path.join(outDir, `edge-live-${index + 1}.png`)
  await page.screenshot({ path: file })
  console.log('shot:', file)
}

// Hard evidence instead of eyeballing: walk every rendered edge path and check
// that no sampled point lands inside a card, and report the clearance.
const avoidance = await page.evaluate(() => {
  const ends = { sync: ['a', 'b'], idle: ['a', 'b'], adjacent: ['c', 'd'] }
  const cards = [...document.querySelectorAll('.react-flow__node')].map(node => {
    const box = node.getBoundingClientRect()
    return { id: node.getAttribute('data-id'), left: box.left, top: box.top, right: box.right, bottom: box.bottom }
  })
  const results = []
  for (const group of document.querySelectorAll('.react-flow__edge')) {
    const path = group.querySelector('path.react-flow__edge-path')
    if (path === null) continue
    const total = path.getTotalLength()
    const matrix = path.getScreenCTM()
    let inside = 0
    let minClearance = Infinity
    // Endpoint cards are supposed to be touched; only "other" cards matter.
    const first = path.getPointAtLength(0)
    const last = path.getPointAtLength(total)
    const toScreen = point => {
      const m = path.getScreenCTM()
      return { x: m.a * point.x + m.c * point.y + m.e, y: m.b * point.x + m.d * point.y + m.f }
    }
    const startScreen = toScreen(first)
    const endScreen = toScreen(last)
    const contains = (card, point) => point.x > card.left - 2 && point.x < card.right + 2 && point.y > card.top - 2 && point.y < card.bottom + 2
    const own = ends[group.getAttribute('data-id') ?? ''] ?? []
    const endCards = cards.filter(card => own.includes(card.id))
    const samples = 400
    for (let index = 0; index <= samples; index += 1) {
      const point = path.getPointAtLength((total * index) / samples)
      const x = matrix.a * point.x + matrix.c * point.y + matrix.e
      const y = matrix.b * point.x + matrix.d * point.y + matrix.f
      for (const card of cards) {
        const inX = x > card.left + 1 && x < card.right - 1
        const inY = y > card.top + 1 && y < card.bottom - 1
        if (inX && inY) inside += 1
        if (endCards.includes(card)) continue
        const dx = Math.max(card.left - x, 0, x - card.right)
        const dy = Math.max(card.top - y, 0, y - card.bottom)
        const distance = Math.hypot(dx, dy)
        if (distance < minClearance) minClearance = distance
      }
    }
    results.push({
      id: group.getAttribute('data-id') ?? '?',
      insideSamples: inside,
      minClearance: Math.round(minClearance * 10) / 10,
      length: Math.round(total),
    })
  }
  return { cards: cards.length, results }
})
const edgeDebug = await page.evaluate(() => window.__edgeDebug ?? [])
console.log('edgeDebug:', JSON.stringify(edgeDebug))
console.log('avoidance:', JSON.stringify(avoidance))
const crossings = avoidance.results.filter(item => item.insideSamples > 0)
if (avoidance.results.length === 0) {
  console.error('FAIL: no edges rendered — the check would be vacuous')
  process.exitCode = 1
}
if (crossings.length > 0) {
  console.error('FAIL: edge passes through a card:', JSON.stringify(crossings))
  process.exitCode = 1
} else {
  console.log('PASS: no edge sample lands inside a card (' + avoidance.results.length + ' lines, ' + avoidance.cards + ' cards)')
}

await browser.close()
edge.kill()
