import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { CARD_W, CARD_H, layoutFor } from '../src/client/grid-layout.ts'
import { pickFaces } from '../src/client/edge-routing.ts'
import { routeBetween } from '../src/client/edge-route.ts'
const raw = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.dsh', 'storages', 'mind_map.json'), 'utf8'))
const cards = Object.entries(raw.tables.cards).map(([id, c]) => ({ id, x: c.x, y: c.y }))
const frames = raw.global?.wsFrames ?? {}
const placed = {}, frameOf = {}
for (const [ws, s] of Object.entries(frames)) {
  const rect = { x: s.x, y: s.y, width: s.width, height: s.height }
  const inside = cards.filter(c => c.x + CARD_W/2 > rect.x && c.x + CARD_W/2 < rect.x + rect.width && c.y + CARD_H/2 > rect.y && c.y + CARD_H/2 < rect.y + rect.height)
  inside.sort((a, b) => (a.y - b.y) || (a.x - b.x))
  Object.assign(placed, layoutFor(rect, inside.map(c => c.id)))
  for (const c of inside) frameOf[c.id] = ws
}
for (const c of cards) if (!placed[c.id]) placed[c.id] = { x: c.x, y: c.y }
const boxes = cards.map(c => ({ id: c.id, x: placed[c.id].x, y: placed[c.id].y, w: CARD_W, h: CARD_H }))
const inFrame = cards.filter(c => frameOf[c.id] && frameOf[c.id] !== 'none')
const counts = {}; for (const c of inFrame) counts[frameOf[c.id]] = (counts[frameOf[c.id]] ?? 0) + 1
const biggestWs = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0]
const ids = inFrame.filter(c => frameOf[c.id] === biggestWs).slice(0, 6).map(c => c.id)
const pairs = []
for (let i=0;i<ids.length;i++) for (let j=i+1;j<ids.length;j++) pairs.push([ids[i], ids[j]])
const anchor = (b, f) => f==='r'?{x:b.x+b.w,y:b.y+b.h/2}:f==='l'?{x:b.x,y:b.y+b.h/2}:f==='b'?{x:b.x+b.w/2,y:b.y+b.h}:{x:b.x+b.w/2,y:b.y}
let bad = 0
for (const [a, b] of pairs) {
  const A = boxes.find(x=>x.id===a), B = boxes.find(x=>x.id===b)
  const faces = pickFaces({id:a,x:A.x,y:A.y},{id:b,x:B.x,y:B.y},boxes.map(x=>({id:x.id,x:x.x,y:x.y})),{cardWidth:CARD_W,cardHeight:CARD_H})
  const others = boxes.filter(x=>x.id!==a&&x.id!==b)
  const pts = routeBetween({start:anchor(A,faces.fromHandle),startFace:faces.fromHandle,end:anchor(B,faces.toHandle),endFace:faces.toHandle},A,B,others.map(o=>({x:o.x,y:o.y,w:o.w,h:o.h})))
  const hit = []
  for (let i=1;i<pts.length;i++){ const p0=pts[i-1],p1=pts[i]; const steps=Math.max(2,Math.ceil((Math.abs(p1.x-p0.x)+Math.abs(p1.y-p0.y))/2))
    for(let s=0;s<=steps;s++){ const t=s/steps, px=p0.x+(p1.x-p0.x)*t, py=p0.y+(p1.y-p0.y)*t
      for (const o of others) if (px>o.x+1&&px<o.x+o.w-1&&py>o.y+1&&py<o.y+o.h-1) { if(!hit.includes(o.id)) hit.push(o.id) } } }
  if (hit.length) { bad++; if (bad<=2) console.log(JSON.stringify({a:a.slice(0,8),b:b.slice(0,8),faces,hit:hit.map(h=>h.slice(0,8)),pts:pts.map(p=>[Math.round(p.x),Math.round(p.y)])})) }
}
console.log(JSON.stringify({ ws: biggestWs, pairs: pairs.length, crossing: bad }))
