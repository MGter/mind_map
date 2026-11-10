import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { pickFaces } from '../src/client/edge-routing.ts'
import { routeEdge } from '../src/client/edge-route.ts'
const W = 224, H = 120
const raw = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.dsh', 'storages', 'mind_map.json'), 'utf8'))
const pool = Object.entries(raw.tables.cards)
  .map(([id, c]) => ({ id, b: c.boardId ?? 'inbox', x: c.x, y: c.y, w: W, h: H }))
  .filter(c => c.b === 'inbox')
const dist = (p, r) => Math.hypot(Math.max(r.x - p.x, 0, p.x - (r.x + r.w)), Math.max(r.y - p.y, 0, p.y - (r.y + r.h)))
let worst = Infinity, crossings = 0, tested = 0
const bad = []
let seed = 12345
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
for (let n = 0; n < 200; n++) {
  const a = pool[Math.floor(rnd() * pool.length)]
  const b = pool[Math.floor(rnd() * pool.length)]
  if (a === b) continue
  const faces = pickFaces({ id: a.id, x: a.x, y: a.y }, { id: b.id, x: b.x, y: b.y },
    pool.map(c => ({ id: c.id, x: c.x, y: c.y })), { cardWidth: W, cardHeight: H })
  const others = pool.filter(c => c.id !== a.id && c.id !== b.id)
  const pts = routeEdge(a, b, faces.fromHandle, faces.toHandle, [a, b, ...others])
  tested++
  let hit = 0, localWorst = Infinity
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i-1], p1 = pts[i]
    const steps = Math.max(4, Math.ceil((Math.abs(p1.x-p0.x)+Math.abs(p1.y-p0.y))/2))
    for (let s = 0; s <= steps; s++) {
      const t = s/steps, p = { x: p0.x + (p1.x-p0.x)*t, y: p0.y + (p1.y-p0.y)*t }
      for (const c of others) {
        const d = dist(p, c)
        // a card that overlaps an endpoint is unavoidable: skip it
        const overlapsEndpoint = [a, b].some(e => e.x < c.x + c.w && c.x < e.x + e.w && e.y < c.y + c.h && c.y < e.y + e.h)
        if (d === 0 && !overlapsEndpoint) hit++
        if (d < localWorst) localWorst = d
      }
    }
  }
  if (hit > 0) { crossings++; if (bad.length < 3) bad.push({ a: a.id.slice(0,8), b: b.id.slice(0,8), hit }) }
  if (localWorst < worst) worst = localWorst
}
console.log(JSON.stringify({ cards: pool.length, tested, edgesCrossingACard: crossings, closestApproachPx: Math.round(worst*10)/10, samples: bad }))