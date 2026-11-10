import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { CARD_W, CARD_H, layoutFor } from '../src/client/grid-layout.ts'
import { routeOnLattice, crossings } from '../src/client/edge-lattice.ts'
const raw = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.dsh', 'storages', 'mind_map.json'), 'utf8'))
const cards = Object.entries(raw.tables.cards).map(([id, c]) => ({ id, x: c.x, y: c.y }))
const frames = raw.global?.wsFrames ?? {}
const pos = {}
for (const stored of Object.values(frames)) {
  const rect = { x: stored.x, y: stored.y, width: stored.width, height: stored.height }
  const inside = cards.filter(c => c.x + CARD_W/2 > rect.x && c.x + CARD_W/2 < rect.x + rect.width
    && c.y + CARD_H/2 > rect.y && c.y + CARD_H/2 < rect.y + rect.height)
  inside.sort((a, b) => (a.y - b.y) || (a.x - b.x) || a.id.localeCompare(b.id))
  Object.assign(pos, layoutFor(rect, inside.map(c => c.id)))
}
const boxes = cards.map(c => ({ id: c.id, x: pos[c.id]?.x ?? c.x, y: pos[c.id]?.y ?? c.y, w: CARD_W, h: CARD_H }))
const faceOf = (a, b) => { const dx = b.x-a.x, dy = b.y-a.y
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? ['r','l'] : ['l','r']) : (dy >= 0 ? ['b','t'] : ['t','b']) }
const anchor = (box, face) => face === 'r' ? { x: box.x+box.w, y: box.y+box.h/2 }
  : face === 'l' ? { x: box.x, y: box.y+box.h/2 }
  : face === 'b' ? { x: box.x+box.w/2, y: box.y+box.h } : { x: box.x+box.w/2, y: box.y }
let tested = 0, dirty = 0; const bad = []
let seed = 7; const rnd = () => (seed = (seed*1103515245+12345) % 2147483648) / 2147483648
for (let n = 0; n < 150; n++) {
  const a = boxes[Math.floor(rnd()*boxes.length)], b = boxes[Math.floor(rnd()*boxes.length)]
  if (a === b) continue
  const [fa, fb] = faceOf(a, b)
  const pts = routeOnLattice({ start: anchor(a, fa), startFace: fa, end: anchor(b, fb), endFace: fb }, boxes)
  const others = boxes.filter(x => x !== a && x !== b)
  let hits = 0
  for (let i = 1; i < pts.length; i++) hits += crossings(others, pts[i-1], pts[i])
  tested++; if (hits > 0) { dirty++; if (bad.length < 3) bad.push({ a: a.id.slice(0,8), b: b.id.slice(0,8), hits }) }
}
console.log(JSON.stringify({ slotted: Object.keys(pos).length, tested, dirty, bad }))