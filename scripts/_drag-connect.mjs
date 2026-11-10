/**
 * Draw the connection myself in a browser, then look at it.
 *
 * A real React Flow canvas with the real edge component: three stacked cards whose
 * geometry mirrors the reported screenshot (the middle card is wider and offset,
 * like a painted 250×129 card inside a 224×120 slot). The script performs an actual
 * mouse drag from the top card's bottom handle to the bottom card's top handle —
 * the same gesture the user makes — then screenshots and measures the drawn path
 * against the drawn cards.
 *
 *   node scripts/_drag-connect.mjs [--shot name.png]
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
import { ReactFlow, ReactFlowProvider, Background, Handle, Position, ConnectionMode, useReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { edgeTypes } from '../../src/client/MindMapEdge.tsx'

const SCENE = ${JSON.stringify(SCENE)}
const CARD_W = 224
const CARD_H = 120

const nodeTypes = {
  card: ({ data }) => (
    <div data-mindmap-session={data.id} style={{ width: data.w, height: data.h, background: '#23262d',
      color: '#cfd6e3', border: '1px solid #333a45', borderRadius: 10, position: 'relative' }}>
      <Handle id="t" type="source" position={Position.Top} />
      <Handle id="r" type="source" position={Position.Right} />
      <Handle id="b" type="source" position={Position.Bottom} />
      <Handle id="l" type="source" position={Position.Left} />
      <span style={{ fontSize: 11 }}>{data.id}</span>
    </div>
  ),
}

function Canvas() {
  const [edges, setEdges] = React.useState([])
  const nodes = SCENE.cards.map(card => ({
    id: card.id, type: 'card', position: { x: card.x, y: card.y },
    data: { id: card.id, w: card.w, h: card.h },
    style: { width: card.w, height: card.h },
  }))

  const connect = (connection) => {
    const from = SCENE.cards.find(card => card.id === connection.source)
    const to = SCENE.cards.find(card => card.id === connection.target)
    const others = SCENE.cards.filter(card => card !== from && card !== to)
    setEdges(current => [...current, {
      id: 'drag-' + current.length,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle,
      targetHandle: connection.targetHandle,
      type: 'mindMap',
      data: {
        sync: 'idle',
        obstacles: others.map(card => ({ x: card.x, y: card.y, w: card.w, h: card.h })),
        fromRect: { x: from.x, y: from.y, w: from.w, h: from.h },
        toRect: { x: to.x, y: to.y, w: to.w, h: to.h },
      },
    }])
  }

  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
      connectionMode={ConnectionMode.Loose} onConnect={connect} fitView>
      <Background />
    </ReactFlow>
  )
}

createRoot(document.getElementById('root')).render(
  <ReactFlowProvider><Canvas /></ReactFlowProvider>,
)
`

fs.mkdirSync('test/shots', { recursive: true })
fs.writeFileSync('test/shots/drag-entry.tsx', entry, 'utf8')
await build({
  entryPoints: ['test/shots/drag-entry.tsx'],
  bundle: true,
  outfile: 'test/shots/drag.js',
  format: 'iife',
  jsx: 'automatic',
  loader: { '.tsx': 'tsx', '.ts': 'ts' },
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'error',
})
fs.writeFileSync('test/shots/drag.html', `<!doctype html><meta charset="utf-8">
<style>html,body,#root{width:100%;height:100%;margin:0;background:#16181d}</style>
<div id="root"></div><script src="./drag.js"></script>`, 'utf8')

const EDGE_BIN = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
  .find(candidate => fs.existsSync(candidate))
const port = 9441
const child = spawn(EDGE_BIN, [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(os.tmpdir(), 'drag-' + Date.now())}`,
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
page.on('pageerror', error => console.log('PAGE ERROR:', String(error).slice(0, 200)))
await page.goto('file:///' + path.resolve('test/shots/drag.html').replace(/\\/g, '/'))
await page.waitForTimeout(1200)
await page.screenshot({ path: 'test/shots/drag-before.png' })
console.log('viewport', await page.evaluate(() => getComputedStyle(document.querySelector('.react-flow__viewport')).transform))
console.log('nodes', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[data-mindmap-session]')].map(el => { const r = el.getBoundingClientRect(); return { id: el.getAttribute('data-mindmap-session'), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }))))

// the actual gesture: press the top card's bottom handle, drag down, release on the
// bottom card's top handle
const handles = await page.evaluate(() => {
  const find = (cardId, handleId) => {
    const node = document.querySelector(`[data-mindmap-session="${cardId}"]`)
    const handle = node?.parentElement?.querySelector(`[data-handleid="${handleId}"]`) ?? node?.querySelector(`[data-handleid="${handleId}"]`)
    if (!handle) return null
    const rect = handle.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }
  return { from: find('top', 'b'), to: find('bottom', 't') }
})
console.log('handles', JSON.stringify(handles))
if (handles.from === null || handles.to === null) {
  console.log('could not find the handles — aborting')
  await browser.close()
  child.kill()
  process.exit(1)
}

await page.mouse.move(handles.from.x, handles.from.y)
await page.mouse.down()
await page.mouse.move(handles.from.x, handles.from.y + 40, { steps: 5 })
await page.mouse.move(handles.to.x, handles.to.y, { steps: 15 })
await page.mouse.up()
await page.waitForTimeout(800)

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
    const hits = new Set()
    for (let distance = 0; distance <= total; distance += 2) {
      const point = pointAt(distance)
      cards.forEach((card, index) => {
        if (own.has(index)) return
        if (point.x > card.x + 1 && point.x < card.x + card.w - 1 && point.y > card.y + 1 && point.y < card.y + card.h - 1) {
          inside += 1
          hits.add(card.id)
        }
      })
    }
    out.push({ id: group.getAttribute('data-id'), inside, hits: [...hits], d: element.getAttribute('d').slice(0, 100) })
  }
  return { cards: cards.length, edges: out }
})

const shot = process.argv.includes('--shot') ? process.argv[process.argv.indexOf('--shot') + 1] : 'test/shots/drag-connect.png'
await page.screenshot({ path: shot, fullPage: false })
await browser.close()
child.kill()

console.log(JSON.stringify({ cards: report.cards, edges: report.edges.length, detail: report.edges }, null, 1))
process.exitCode = report.edges.some(edge => edge.inside > 0) ? 1 : 0
