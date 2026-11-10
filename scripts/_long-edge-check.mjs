import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { pickFaces } from '../src/client/edge-routing.ts'
import { routeEdge } from '../src/client/edge-route.ts'
const W = 224, H = 120
const raw = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.dsh', 'storages', 'mind_map.json'), 'utf8'))
const cards = Object.entries(raw.tables.cards).map(([id, c]) => ({ id, b: c.boardId ?? 'inbox', x: c.x, y: c.y, w: W, h: H }))
const pool = cards.filter(c => c.b === 'inbox')
const sorted = [...pool].sort((a, b) => (a.y - b.y) || (a.x - b.x))
const from = sorted[0], to = sorted[sorted.length - 1]
const faces = pickFaces({ id: from.id, x: from.x, y: from.y }, { id: to.id, x: to.x, y: to.y },
  pool.map(c => ({ id: c.id, x: c.x, y: c.y })), { cardWidth: W, cardHeight: H })
const others = pool.filter(c => c.id !== from.id && c.id !== to.id)
const pts = routeEdge(from, to, faces.fromHandle, faces.toHandle, [from, to, ...others])
const dist = (p, r) => Math.hypot(Math.max(r.x - p.x, 0, p.x - (r.x + r.w)), Math.max(r.y - p.y, 0, p.y - (r.y + r.h)))
let worst = Infinity, inside = 0
for (let i = 1; i < pts.length; i++) {
  const a = pts[i-1], b = pts[i]
  const steps = Math.max(4, Math.ceil((Math.abs(b.x-a.x)+Math.abs(b.y-a.y))/2))
  for (let s = 0; s <= steps; s++) {
    const t = s/steps, p = { x: a.x + (b.x-a.x)*t, y: a.y + (b.y-a.y)*t }
    for (const c of others) { const d = dist(p, c); if (d < worst) worst = d; if (d === 0) inside++ }
  }
}
console.log(JSON.stringify({ from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, faces,
  distance: Math.round(Math.hypot(to.x-from.x, to.y-from.y)), waypoints: pts.length,
  closestApproachPx: Math.round(worst*10)/10, samplesInsideACard: inside }))