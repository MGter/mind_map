
import React from 'react'
import { createRoot } from 'react-dom/client'
import { MindMapEdge } from '../../src/client/MindMapEdge.tsx'

const CARD = { w: 224, h: 120 }
const GAP = 56

// A: side by side, bottom → bottom
const A = {
  from: { id: 'a1', x: 0, y: 0 },
  to: { id: 'a2', x: CARD.w + 48, y: 0 },
  fromHandle: 'b', toHandle: 'b',
}
// B: stacked, left → left
const B = {
  from: { id: 'b1', x: 0, y: 0 },
  to: { id: 'b2', x: 0, y: CARD.h + GAP },
  fromHandle: 'l', toHandle: 'l',
}

const anchor = (card, handle) => handle === 'r' ? { x: card.x + CARD.w, y: card.y + CARD.h / 2 }
  : handle === 'l' ? { x: card.x, y: card.y + CARD.h / 2 }
  : handle === 't' ? { x: card.x + CARD.w / 2, y: card.y }
  : { x: card.x + CARD.w / 2, y: card.y + CARD.h }
const clock = (handle) => handle === 'r' ? 'right' : handle === 'l' ? 'left' : handle === 't' ? 'top' : 'bottom'

function scene(spec, offsetX, offsetY) {
  const from = { ...spec.from, x: spec.from.x + offsetX, y: spec.from.y + offsetY }
  const to = { ...spec.to, x: spec.to.x + offsetX, y: spec.to.y + offsetY }
  const boxes = [from, to].map(card => ({ x: card.x, y: card.y, w: CARD.w, h: CARD.h }))
  const start = anchor(from, spec.fromHandle)
  const end = anchor(to, spec.toHandle)
  const props = {
    id: 'edge-' + from.id + '-' + to.id,
    source: from.id, target: to.id,
    sourceX: start.x, sourceY: start.y, targetX: end.x, targetY: end.y,
    sourcePosition: clock(spec.fromHandle), targetPosition: clock(spec.toHandle),
    sourceHandleId: spec.fromHandle, targetHandleId: spec.toHandle,
    selected: false, animated: false, interactionWidth: 18,
    type: 'mindMap', markerEnd: undefined,
    data: {
      sync: 'idle',
      obstacles: [],                       // only the two endpoints exist in this scene
      fromRect: boxes[0], toRect: boxes[1],
    },
  }
  return { cards: [from, to], props }
}

const a = scene(A, 40, 40)
const b = scene(B, 40, 260)

createRoot(document.getElementById('root')).render(
  <>
    <svg width={1200} height={900} style={{ position: 'absolute', inset: 0 }}>
      <MindMapEdge {...a.props} />
      <MindMapEdge {...b.props} />
    </svg>
    {[...a.cards, ...b.cards].map(card => (
      <div key={card.id} data-mindmap-session={card.id}
        style={{ position: 'absolute', left: card.x, top: card.y, width: CARD.w, height: CARD.h,
          boxSizing: 'border-box', background: '#23262d', border: '1px solid #333a45',
          borderRadius: 10, color: '#cfd6e3', fontSize: 11 }}>{card.id}</div>
    ))}
  </>,
)
