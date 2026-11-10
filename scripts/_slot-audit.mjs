/**
 * Audit stored edges using the REAL slot layout (frames + slotPoint), which is
 * what the canvas actually draws — not the stored card x/y.
 *
 *   node scripts/_slot-audit.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CARD_W, CARD_H, FRAME_PAD, FRAME_LABEL_H, GAP_X, GAP_Y, colsForWidth, layoutFor } from '../src/client/grid-layout.ts'
import { pickFaces } from '../src/client/edge-routing.ts'
import { routeEdge } from '../src/client/edge-route.ts'

const raw = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.dsh', 'storages', 'mind_map.json'), 'utf8'))
const cards = Object.entries(raw.tables.cards).map(([id, c]) => ({
  id, boardId: c.boardId ?? 'inbox', x: c.x, y: c.y,
}))
const edges = Object.entries(raw.tables.edges).map(([id, e]) => ({ id, ...e }))
const frames = raw.global?.wsFrames ?? {}

// 1. assign every card to the frame it sits in (by stored centre), in reading order
const slots = {}
let frameCount = 0
for (const [wsId, stored] of Object.entries(frames)) {
  const rect = { x: stored.x, y: stored.y, width: stored.width, height: stored.height }
  frameCount += 1
  const inside = cards.filter(card => {
    const cx = card.x + CARD_W / 2
    const cy = card.y + CARD_H / 2
    return cx > rect.x && cx < rect.x + rect.width && cy > rect.y && cy < rect.y + rect.height
  })
  inside.sort((a, b) => (a.y - b.y) || (a.x - b.x) || a.id.localeCompare(b.id))
  const placed = layoutFor(rect, inside.map(card => card.id))
  Object.assign(slots, placed, { __ws: wsId })
}

const pos = id => slots[id] ?? (() => {
  const card = cards.find(c => c.id === id)
  return { x: card.x, y: card.y }
})()

console.log(JSON.stringify({ frames: frameCount, cards: cards.length, edges: edges.length, slotted: Object.keys(slots).length - frameCount }))

const rectOf = id => ({ x: pos(id).x, y: pos(id).y, w: CARD_W, h: CARD_H })
const all = cards.map(card => rectOf(card.id))
const dist = (p, r) => Math.hypot(
  Math.max(r.x - p.x, 0, p.x - (r.x + r.w)),
  Math.max(r.y - p.y, 0, p.y - (r.y + r.h)),
)

for (const edge of edges) {
  const from = rectOf(edge.fromCardId)
  const to = rectOf(edge.toCardId)
  const obstacles = all.filter((_, index) => cards[index].id !== edge.fromCardId && cards[index].id !== edge.toCardId)
  const faces = pickFaces(
    { id: edge.fromCardId, x: from.x, y: from.y },
    { id: edge.toCardId, x: to.x, y: to.y },
    all.map((r, index) => ({ id: cards[index].id, x: r.x, y: r.y })),
    { cardWidth: CARD_W, cardHeight: CARD_H },
  )
  const points = routeEdge(from, to, faces.fromHandle, faces.toHandle, [from, to, ...obstacles])
  let worst = Infinity
  let inside = 0
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]
    const b = points[index]
    const steps = Math.max(4, Math.ceil((Math.abs(b.x - a.x) + Math.abs(b.y - a.y)) / 2))
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps
      const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
      for (const rect of obstacles) {
        const d = dist(point, rect)
        if (d < worst) worst = d
        if (d === 0) inside += 1
      }
    }
  }
  console.log(JSON.stringify({
    edge: edge.id.slice(0, 10),
    from: edge.fromCardId.slice(0, 8),
    to: edge.toCardId.slice(0, 8),
    fromAt: [Math.round(from.x), Math.round(from.y)],
    toAt: [Math.round(to.x), Math.round(to.y)],
    faces,
    wps: points.length,
    inside,
    closest: Math.round(worst * 10) / 10,
    path: points.map(p => [Math.round(p.x), Math.round(p.y)]),
  }))
}
