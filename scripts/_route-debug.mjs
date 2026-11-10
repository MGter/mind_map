/** Why does one edge fall back? Print the routing inputs for it. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { anchorOf, corridors, outerLines, normalOf } from '../src/client/edge-route.ts'
import { pickFaces } from '../src/client/edge-routing.ts'

const CARD_W = 224
const CARD_H = 120
const raw = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.dsh', 'storages', 'mind_map.json'), 'utf8'))
const cards = Object.entries(raw.tables.cards).map(([id, card]) => ({
  id, boardId: card.boardId, x: card.x, y: card.y, w: CARD_W, h: CARD_H,
}))
const edges = Object.entries(raw.tables.edges).map(([id, edge]) => ({ id, ...edge }))

for (const edge of edges) {
  const pool = cards.filter(card => card.boardId === (cards.find(c => c.id === edge.fromCardId)?.boardId))
  const from = pool.find(card => card.id === edge.fromCardId)
  const to = pool.find(card => card.id === edge.toCardId)
  const faces = pickFaces({ id: from.id, x: from.x, y: from.y }, { id: to.id, x: to.x, y: to.y },
    pool.map(card => ({ id: card.id, x: card.x, y: card.y })), { cardWidth: CARD_W, cardHeight: CARD_H })
  const start = anchorOf({ x: from.x, y: from.y, w: from.w, h: from.h }, faces.fromHandle)
  const end = anchorOf({ x: to.x, y: to.y, w: to.w, h: to.h }, faces.toHandle)
  const ns = normalOf(faces.fromHandle)
  const ne = normalOf(faces.toHandle)
  const startStub = { x: start.x + ns.x * 14, y: start.y + ns.y * 14 }
  const endStub = { x: end.x + ne.x * 14, y: end.y + ne.y * 14 }

  const pad = 260
  const window = {
    x1: Math.min(start.x, end.x) - pad, x2: Math.max(start.x, end.x) + pad,
    y1: Math.min(start.y, end.y) - pad, y2: Math.max(start.y, end.y) + pad,
  }
  const near = pool.filter(rect => rect.x + rect.w >= window.x1 && rect.x <= window.x2
    && rect.y + rect.h >= window.y1 && rect.y <= window.y2)
  const xs = corridors(near, 'x', 28).filter(v => v >= window.x1 && v <= window.x2)
  const ys = corridors(near, 'y', 28).filter(v => v >= window.y1 && v <= window.y2)
  const xo = outerLines(near, 'x', 16).filter(v => v >= window.x1 && v <= window.x2)
  const yo = outerLines(near, 'y', 16).filter(v => v >= window.y1 && v <= window.y2)

  console.log(JSON.stringify({
    edge: edge.id.slice(0, 8),
    faces,
    start, end, startStub, endStub,
    nearCards: near.length,
    corridorsX: xs.length, corridorsY: ys.length, outerX: xo.length, outerY: yo.length,
    // is the start stub inside some non-endpoint card?
    startStubBlockedBy: near
      .filter(card => card.id !== from.id && card.id !== to.id)
      .filter(card => startStub.x > card.x - 10 && startStub.x < card.x + card.w + 10
        && startStub.y > card.y - 10 && startStub.y < card.y + card.h + 10)
      .map(card => card.id.slice(0, 8)),
    endStubBlockedBy: near
      .filter(card => card.id !== from.id && card.id !== to.id)
      .filter(card => endStub.x > card.x - 10 && endStub.x < card.x + card.w + 10
        && endStub.y > card.y - 10 && endStub.y < card.y + card.h + 10)
      .map(card => card.id.slice(0, 8)),
  }))
}
