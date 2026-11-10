/**
 * Audit the real map: recompute every stored edge's route from the live storage
 * file and report any segment that touches a card.
 *
 *   node scripts/_route-audit.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pickFaces } from '../src/client/edge-routing.ts'
import { routeEdge } from '../src/client/edge-route.ts'

const CARD_W = 224
const CARD_H = 120

const file = path.join(os.homedir(), '.dsh', 'storages', 'mind_map.json')
const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
const cardsTable = raw.tables?.cards ?? {}
const edgesTable = raw.tables?.edges ?? {}

const cards = Object.entries(cardsTable).map(([id, card]) => ({
  id,
  boardId: card.boardId ?? 'inbox',
  x: card.x,
  y: card.y,
  w: card.w ?? CARD_W,
  h: card.h ?? CARD_H,
}))

const byBoard = new Map()
for (const card of cards) {
  if (!byBoard.has(card.boardId)) byBoard.set(card.boardId, [])
  byBoard.get(card.boardId).push(card)
}

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** Distance from a run to the nearest card edge on each side (0 = touching). */
function runClearance(points, rects) {
  let worst = { gap: Infinity, at: null }
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]
    const b = points[index]
    const horizontal = Math.abs(a.y - b.y) < 0.6
    const lo = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y)
    const hi = horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y)
    const fixed = horizontal ? a.y : a.x
    for (const rect of rects) {
      // only cards the run passes alongside
      if (horizontal) {
        if (hi <= rect.x || lo >= rect.x + rect.w) continue
        const gap = fixed < rect.y ? rect.y - fixed : (fixed > rect.y + rect.h ? fixed - (rect.y + rect.h) : -1)
        if (gap >= 0 && gap < worst.gap) worst = { gap, at: { x: fixed, y: fixed === a.y ? a.y : a.y, rect: rect.id } }
      } else {
        if (hi <= rect.y || lo >= rect.y + rect.h) continue
        const gap = fixed < rect.x ? rect.x - fixed : (fixed > rect.x + rect.w ? fixed - (rect.x + rect.w) : -1)
        if (gap >= 0 && gap < worst.gap) worst = { gap, at: { x: fixed, rect: rect.id } }
      }
    }
  }
  return worst
}

let total = 0
let crossing = 0
let tight = 0
const worstList = []

for (const [edgeId, edge] of Object.entries(edgesTable)) {
  const board = cards.find(card => card.id === edge.fromCardId)
  const boardId = board?.boardId ?? 'inbox'
  const pool = byBoard.get(boardId) ?? []
  const from = pool.find(card => card.id === edge.fromCardId)
  const to = pool.find(card => card.id === edge.toCardId)
  if (from === undefined || to === undefined) continue
  total += 1

  const faces = pickFaces(
    { id: from.id, x: from.x, y: from.y },
    { id: to.id, x: to.x, y: to.y },
    pool.map(card => ({ id: card.id, x: card.x, y: card.y })),
    { cardWidth: CARD_W, cardHeight: CARD_H },
  )
  const others = pool.filter(card => card.id !== from.id && card.id !== to.id)
  const points = routeEdge(
    { x: from.x, y: from.y, w: from.w, h: from.h },
    { x: to.x, y: to.y, w: to.w, h: to.h },
    faces.fromHandle, faces.toHandle,
    [{ x: from.x, y: from.y, w: from.w, h: from.h }, { x: to.x, y: to.y, w: to.w, h: to.h },
      ...others.map(card => ({ x: card.x, y: card.y, w: card.w, h: card.h }))],
  )

  // does any sampled point fall inside another card?
  let hit = null
  for (let index = 1; index < points.length && hit === null; index += 1) {
    const a = points[index - 1]
    const b = points[index]
    const steps = Math.max(2, Math.ceil((Math.abs(b.x - a.x) + Math.abs(b.y - a.y)) / 4))
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps
      const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
      const inside = others.find(card => point.x > card.x + 1 && point.x < card.x + card.w - 1
        && point.y > card.y + 1 && point.y < card.y + card.h - 1)
      if (inside !== undefined) { hit = { point, card: inside.id }; break }
    }
  }
  if (hit !== null) {
    crossing += 1
    worstList.push({ edgeId, card: hit.card, point: { x: Math.round(hit.point.x), y: Math.round(hit.point.y) }, points: points.length })
  }

  const clearance = runClearance(points, others)
  if (clearance.gap < 8) tight += 1
}

// detail for the failing edge
for (const entry of worstList) {
  const edge = edgesTable[entry.edgeId]
  const pool = byBoard.get(cards.find(card => card.id === edge.fromCardId)?.boardId ?? 'inbox') ?? []
  const from = pool.find(card => card.id === edge.fromCardId)
  const to = pool.find(card => card.id === edge.toCardId)
  const faces = pickFaces({ id: from.id, x: from.x, y: from.y }, { id: to.id, x: to.x, y: to.y },
    pool.map(card => ({ id: card.id, x: card.x, y: card.y })), { cardWidth: CARD_W, cardHeight: CARD_H })
  const others = pool.filter(card => card.id !== from.id && card.id !== to.id)
  const points = routeEdge({ x: from.x, y: from.y, w: from.w, h: from.h }, { x: to.x, y: to.y, w: to.w, h: to.h },
    faces.fromHandle, faces.toHandle,
    [{ x: from.x, y: from.y, w: from.w, h: from.h }, { x: to.x, y: to.y, w: to.w, h: to.h },
      ...others.map(card => ({ x: card.x, y: card.y, w: card.w, h: card.h }))])
  console.log('DETAIL', JSON.stringify({
    edgeId: entry.edgeId,
    faces,
    from: { x: from.x, y: from.y },
    to: { x: to.x, y: to.y },
    poolSize: pool.length,
    points,
  }))
}

console.log(JSON.stringify({
  cards: cards.length,
  edges: total,
  edgesCrossingACard: crossing,
  edgesRunningCloserThan8px: tight,
  crossings: worstList.slice(0, 8),
}, null, 1))
