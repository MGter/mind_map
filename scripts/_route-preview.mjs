/**
 * Render the real map (cards + routed edges) to a PNG so the result can be
 * inspected with eyes instead of trusting the router's own bookkeeping.
 *
 *   node scripts/_route-preview.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
import { pickFaces } from '../src/client/edge-routing.ts'
import { routeEdge, roundedPath } from '../src/client/edge-route.ts'

const CARD_W = 224
const CARD_H = 120
const raw = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.dsh', 'storages', 'mind_map.json'), 'utf8'))

// `--synthetic` renders a board shaped like the reported case: a parent card, a
// child two rows below in the same column, a neighbouring column, and a far-off
// card at an offset height so the global row bands merge.
const SYNTHETIC = process.argv.includes('--synthetic')
const synthCards = [
  { id: 'L1', boardId: 'syn', x: 0, y: 0, w: CARD_W, h: CARD_H, title: 'left-1' },
  { id: 'L2', boardId: 'syn', x: 0, y: 176, w: CARD_W, h: CARD_H, title: 'left-2' },
  { id: 'P', boardId: 'syn', x: 272, y: 0, w: CARD_W, h: CARD_H, title: 'PARENT' },
  { id: 'M', boardId: 'syn', x: 272, y: 176, w: CARD_W, h: CARD_H, title: 'middle' },
  { id: 'C', boardId: 'syn', x: 272, y: 352, w: CARD_W, h: CARD_H, title: 'CHILD' },
  { id: 'F', boardId: 'syn', x: 900, y: 88, w: CARD_W, h: CARD_H, title: 'far' },
]
const synthEdges = [{ id: 'edge-syn', boardId: 'syn', fromCardId: 'P', toCardId: 'C' }]

const cards = SYNTHETIC ? synthCards : Object.entries(raw.tables.cards).map(([id, card]) => ({
  id,
  boardId: card.boardId ?? 'inbox',
  x: card.x,
  y: card.y,
  w: CARD_W,
  h: CARD_H,
  title: String(card.sessionId ?? id).slice(0, 8),
}))
const edges = SYNTHETIC ? synthEdges : Object.entries(raw.tables.edges).map(([id, edge]) => ({ id, ...edge }))

// one board, the one with the most cards
const byBoard = new Map()
for (const card of cards) {
  if (!byBoard.has(card.boardId)) byBoard.set(card.boardId, [])
  byBoard.get(card.boardId).push(card)
}
const [boardId, boardCards] = [...byBoard.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? ['inbox', []]
const boardEdges = edges.filter(edge => boardCards.some(card => card.id === edge.fromCardId))

// bound the picture to the area that actually has content
const minX = Math.min(...boardCards.map(card => card.x))
const minY = Math.min(...boardCards.map(card => card.y))
const maxX = Math.max(...boardCards.map(card => card.x + card.w))
const maxY = Math.max(...boardCards.map(card => card.y + card.h))
const pad = 60
const width = maxX - minX + pad * 2
const height = maxY - minY + pad * 2

const parts = []
parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#16181d"/>`)
for (const card of boardCards) {
  parts.push(`<rect x="${card.x - minX + pad}" y="${card.y - minY + pad}" width="${card.w}" height="${card.h}" rx="10" fill="#23262d" stroke="#3a4150"/>`)
  parts.push(`<text x="${card.x - minX + pad + 12}" y="${card.y - minY + pad + 26}" fill="#cfd6e3" font-size="13" font-family="system-ui">${card.title}</text>`)
}

const report = []
for (const edge of boardEdges) {
  const from = boardCards.find(card => card.id === edge.fromCardId)
  const to = boardCards.find(card => card.id === edge.toCardId)
  if (from === undefined || to === undefined) continue
  const faces = pickFaces(
    { id: from.id, x: from.x, y: from.y },
    { id: to.id, x: to.x, y: to.y },
    boardCards.map(card => ({ id: card.id, x: card.x, y: card.y })),
    { cardWidth: CARD_W, cardHeight: CARD_H },
  )
  const others = boardCards.filter(card => card.id !== from.id && card.id !== to.id)
  const points = routeEdge(
    { x: from.x, y: from.y, w: from.w, h: from.h },
    { x: to.x, y: to.y, w: to.w, h: to.h },
    faces.fromHandle, faces.toHandle,
    [{ x: from.x, y: from.y, w: from.w, h: from.h }, { x: to.x, y: to.y, w: to.w, h: to.h },
      ...others.map(card => ({ x: card.x, y: card.y, w: card.w, h: card.h }))],
  )
  const shifted = points.map(point => ({ x: point.x - minX + pad, y: point.y - minY + pad }))
  parts.push(`<path d="${roundedPath(shifted, 10)}" fill="none" stroke="#e8eefc" stroke-width="2" stroke-dasharray="6 5" opacity="0.95"/>`)
  const tip = shifted[shifted.length - 1]
  const prev = shifted[shifted.length - 2]
  const angle = Math.abs(tip.x - prev.x) >= Math.abs(tip.y - prev.y)
    ? (tip.x >= prev.x ? 0 : 180)
    : (tip.y >= prev.y ? 90 : -90)
  parts.push(`<path d="M0 0 L-11 -5 L-11 5 Z" transform="translate(${tip.x} ${tip.y}) rotate(${angle})" fill="#e8eefc"/>`)
  report.push({ edge: edge.id.slice(0, 8), faces, points: points.length })
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`
const htmlPath = path.join(os.tmpdir(), 'mindmap-route-preview.html')
fs.writeFileSync(htmlPath, `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#16181d">${svg}</body>`, 'utf8')

// screenshot it
const EDGE_BIN = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(candidate => fs.existsSync(candidate))
const profileDir = path.join(os.tmpdir(), 'mindmap-route-preview-profile')
fs.rmSync(profileDir, { recursive: true, force: true })
const CDP = 9371
const browserProcess = spawn(EDGE_BIN, [
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${profileDir}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  `--window-size=${Math.min(width + 20, 1800)},${Math.min(height + 20, 1200)}`, '--headless=new', 'about:blank',
], { stdio: 'ignore' })

const deadline = Date.now() + 20000
let version = null
while (Date.now() < deadline && version === null) {
  try {
    const response = await fetch(`http://127.0.0.1:${CDP}/json/version`)
    if (response.ok) version = await response.json()
  } catch { /* not up yet */ }
  if (version === null) await new Promise(resolve => setTimeout(resolve, 250))
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP}`)
const context = browser.contexts()[0] ?? await browser.newContext()
const page = context.pages()[0] ?? await context.newPage()
await page.setViewportSize({ width: Math.min(width + 20, 1800), height: Math.min(height + 20, 1200) })
await page.goto('file:///' + htmlPath.replace(/\\/g, '/'))
await page.waitForTimeout(300)
const out = path.join('test', 'shots', `route-preview-${boardId}.png`)
fs.mkdirSync(path.dirname(out), { recursive: true })
await page.screenshot({ path: out, fullPage: true })
await browser.close()
browserProcess.kill()

console.log(JSON.stringify({ board: boardId, cards: boardCards.length, edges: boardEdges.length, size: { width, height }, shot: out, report }, null, 1))
