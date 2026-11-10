/**
 * Several map edges at once: do they overlap each other, does each arrow head point into
 * its card, does any line cross a card?
 *
 *   node scripts/_map-multi.mjs [--shot name.png]
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
import { ReactFlowProvider, ReactFlow } from '@xyflow/react'
import { MindMapEdge, edgeTypes } from '../../src/client/MindMapEdge.tsx'

const W = 224
const H = 120
const GX = 48
const GY = 56
const COLS = 3
const ROWS = 3

const cards = []
for (let row = 0; row < ROWS; row += 1) {
  for (let col = 0; col < COLS; col += 1) {
    cards.push({ id: 'c' + row + col, x: col * (W + GX), y: row * (H + GY), w: W, h: H })
  }
}

const boxOf = id => cards.find(card => card.id === id)
const anchor = (card, face) => face === 't' ? { x: card.x + card.w / 2, y: card.y }
  : face === 'b' ? { x: card.x + card.w / 2, y: card.y + card.h }
    : face === 'l' ? { x: card.x, y: card.y + card.h / 2 }
      : { x: card.x + card.w, y: card.y + card.h / 2 }
const position = face => face === 't' ? 'top' : face === 'b' ? 'bottom' : face === 'l' ? 'left' : 'right'

// Pairs that force lines into the same gutters, plus one ordinary neighbour link.
const LINKS = [
  ['c00', 'c22', 'r', 'l'],
  ['c10', 'c01', 't', 'b'],
  ['c20', 'c02', 'r', 'l'],
  ['c00', 'c01', 'r', 'l'],
  ['c11', 'c21', 'b', 'b'],
  ['c12', 'c02', 'l', 'r'],
]

const obstacles = cards.map(card => ({ x: card.x, y: card.y, w: card.w, h: card.h }))

const edges = LINKS.map(([from, to, fromFace, toFace], index) => {
  const a = boxOf(from)
  const b = boxOf(to)
  const start = anchor(a, fromFace)
  const end = anchor(b, toFace)
  return {
    id: 'e' + index,
    source: from,
    target: to,
    type: 'mindMap',
    sourcePosition: position(fromFace),
    targetPosition: position(toFace),
    data: {
      sync: 'idle',
      obstacles,
      fromRect: a,
      toRect: b,
      sourceX: start.x,
      sourceY: start.y,
      targetX: end.x,
      targetY: end.y,
    },
  }
})

const nodes = cards.map(card => ({
  id: card.id,
  position: { x: card.x, y: card.y },
  data: { label: card.id },
  type: 'default',
  style: { width: card.w, height: card.h, background: '#23262d', border: '1px solid #333a45',
    borderRadius: 10, color: '#cfd6e3', fontSize: 12 },
}))

// MindMapEdge gets its coordinates from React Flow; mirror them onto the node handles.
const withHandles = edges.map(edge => {
  const a = boxOf(edge.source)
  const b = boxOf(edge.target)
  const start = anchor(a, edge.sourcePosition === 'right' ? 'r' : edge.sourcePosition === 'left' ? 'l' : edge.sourcePosition === 'top' ? 't' : 'b')
  const end = anchor(b, edge.targetPosition === 'right' ? 'r' : edge.targetPosition === 'left' ? 'l' : edge.targetPosition === 'top' ? 't' : 'b')
  return {
    ...edge,
    data: { ...edge.data, sourceX: start.x, sourceY: start.y, targetX: end.x, targetY: end.y },
  }
})

function Scene() {
  return React.createElement(ReactFlowProvider, null,
    React.createElement('div', { style: { width: 1100, height: 620, position: 'relative' } },
      React.createElement(ReactFlow, {
        nodes,
        edges: withHandles,
        edgeTypes,
        fitView: false,
        proOptions: { hideAttribution: true },
        nodeOrigin: [0, 0],
        defaultViewport: { x: 20, y: 20, zoom: 1 },
      })))
}

createRoot(document.getElementById('root')).render(React.createElement(Scene))
`

fs.mkdirSync('test/shots', { recursive: true })
fs.writeFileSync('test/shots/mapmulti-entry.tsx', entry, 'utf8')

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
  entryPoints: ['test/shots/mapmulti-entry.tsx'],
  bundle: true,
  outfile: 'test/shots/mapmulti.js',
  format: 'iife',
  jsx: 'automatic',
  loader: { '.tsx': 'tsx', '.ts': 'ts' },
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [cssStub],
  logLevel: 'error',
})

const rawCss = fs.readFileSync('src/client/mind-map.module.css', 'utf8')
const scopedCss = rawCss.replace(/:global\(([^()]*)\)/g, '$1').replace(/\.([a-zA-Z][\w-]*)/g, '.tm_$1')
fs.writeFileSync('test/shots/mapmulti.html', `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="https://unpkg.com/@xyflow/react@12/dist/style.css">
<style>
  html, body { margin: 0; background: #0d0f13; color: #cfd6e3; font: 13px system-ui, sans-serif; }
${scopedCss}
</style>
<div id="root"></div><script src="./mapmulti.js"></script>`, 'utf8')

const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
  .find(candidate => fs.existsSync(candidate))
const port = 9581
const child = spawn(EDGE, [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(os.tmpdir(), 'mm-' + Date.now())}`,
  '--no-first-run', '--headless=new', '--window-size=1200,760', 'about:blank'], { stdio: 'ignore' })

let ready = false
const started = Date.now()
while (Date.now() - started < 20000 && !ready) {
  try { ready = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok } catch { /* not up */ }
  if (!ready) await new Promise(resolve => setTimeout(resolve, 200))
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const page = browser.contexts()[0].pages()[0] ?? await browser.contexts()[0].newPage()
await page.setViewportSize({ width: 1200, height: 760 })
const errors = []
page.on('pageerror', error => errors.push(String(error).slice(0, 160)))
await page.goto('file:///' + path.resolve('test/shots/mapmulti.html').replace(/\\/g, '/'))
await page.waitForTimeout(1500)

const report = await page.evaluate(() => {
  const layer = document.querySelector('.react-flow__edges')
  if (layer === null) return { error: 'no edges', body: document.body.innerHTML.slice(0, 120) }
  const svg = layer.tagName.toLowerCase() === 'svg' ? layer : layer.querySelector('svg')
  const matrix = svg === null ? null : svg.getScreenCTM()
  const toScreen = point => (matrix === null ? point : new DOMPoint(point.x, point.y).matrixTransform(matrix))
  const nodes = [...document.querySelectorAll('.react-flow__node')].map(element => {
    const rect = element.getBoundingClientRect()
    return { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
  })
  const visible = [...layer.querySelectorAll('path')].filter(element => {
    const d = element.getAttribute('d') ?? ''
    const cls = element.getAttribute('class') ?? ''
    return d.length > 20 && !d.startsWith('M0 0') && !cls.includes('interaction')
  })
  const lines = visible.map(element => {
    const total = element.getTotalLength()
    const points = []
    for (let distance = 0; distance <= total; distance += 3) points.push(toScreen(element.getPointAtLength(distance)))
    return points
  })
  const heads = [...layer.querySelectorAll('path')].filter(element => (element.getAttribute('d') ?? '').startsWith('M0 0')).map(element => {
    const transform = element.getAttribute('transform') ?? ''
    const translate = /translate\(([-\d.]+)[ ,]([-\d.]+)\)/.exec(transform)
    const rotate = /rotate\(([-\d.]+)\)/.exec(transform)
    if (translate === null) return null
    const point = toScreen({ x: Number(translate[1]), y: Number(translate[2]) })
    return { x: point.x, y: point.y, angle: rotate === null ? 0 : Number(rotate[1]) }
  }).filter(Boolean)

  const badArrows = []
  for (const head of heads) {
    let nearest = null
    let best = Number.POSITIVE_INFINITY
    for (const node of nodes) {
      const dx = Math.max(node.x - head.x, 0, head.x - (node.x + node.w))
      const dy = Math.max(node.y - head.y, 0, head.y - (node.y + node.h))
      const distance = Math.hypot(dx, dy)
      if (distance < best) { best = distance; nearest = node }
    }
    if (nearest === null || best > 8) continue
    const radians = (head.angle * Math.PI) / 180
    const dir = { x: Math.cos(radians), y: Math.sin(radians) }
    const normal = [
      { d: Math.abs(head.y - nearest.y), n: { x: 0, y: 1 } },
      { d: Math.abs(head.y - (nearest.y + nearest.h)), n: { x: 0, y: -1 } },
      { d: Math.abs(head.x - nearest.x), n: { x: 1, y: 0 } },
      { d: Math.abs(head.x - (nearest.x + nearest.w)), n: { x: -1, y: 0 } },
    ].sort((a, b) => a.d - b.d)[0].n
    const inward = dir.x * normal.x + dir.y * normal.y
    if (inward < 0.7) badArrows.push({ angle: head.angle, inward: Math.round(inward * 100) / 100 })
  }

  const twins = []
  for (let a = 0; a < lines.length; a += 1) {
    for (let b = a + 1; b < lines.length; b += 1) {
      let close = 0
      for (const pointA of lines[a]) {
        for (const pointB of lines[b]) {
          if (Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y) < 6) { close += 1; break }
        }
      }
      if (close / Math.max(1, lines[a].length) > 0.35) twins.push({ a, b })
    }
  }

  let crossings = 0
  for (const line of lines) {
    for (const point of line) {
      for (const node of nodes) {
        if (point.x > node.x + 2 && point.x < node.x + node.w - 2 && point.y > node.y + 2 && point.y < node.y + node.h - 2) crossings += 1
      }
    }
  }

  return { edges: lines.length, heads: heads.length, badArrows, twins, crossings }
})

await page.screenshot({ path: process.argv.includes('--shot') ? process.argv[process.argv.indexOf('--shot') + 1] : 'test/shots/map-multi.png' })
await browser.close()
child.kill()
console.log(JSON.stringify({ errors, report }, null, 1))
