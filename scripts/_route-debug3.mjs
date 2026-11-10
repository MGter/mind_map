import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { routeEdge, __routeDebug } from '../src/client/edge-route.ts'
const W = 224, H = 120
const raw = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.dsh', 'storages', 'mind_map.json'), 'utf8'))
const cards = Object.entries(raw.tables.cards).map(([id, c]) => ({ id, b: c.boardId ?? 'inbox', x: c.x, y: c.y, w: W, h: H }))
const pool = cards.filter(c => c.b === 'inbox').sort((a, b) => (a.y - b.y) || (a.x - b.x))
const from = pool[0], to = pool[pool.length - 1]
const others = pool.filter(c => c.id !== from.id && c.id !== to.id)
const pts = routeEdge(from, to, 'b', 't', [from, to, ...others])
console.log('debug:', JSON.stringify(__routeDebug))
console.log('endpoints:', JSON.stringify({ from: [from.x, from.y], to: [to.x, to.y], cards: pool.length }))
console.log('waypoints:', pts.length, JSON.stringify(pts.slice(0, 8)))