
import React from 'react'
import { createRoot } from 'react-dom/client'
import { MindMapEdge } from '../../src/client/MindMapEdge.tsx'

const SCENE = {"cards":[{"id":"top","x":0,"y":0,"w":224,"h":120},{"id":"mid","x":4,"y":176,"w":250,"h":129},{"id":"bottom","x":0,"y":361,"w":224,"h":120}]}
const top = SCENE.cards[0]
const mid = SCENE.cards[1]
const bottom = SCENE.cards[2]

const noObstacles = true
const obstacles = noObstacles ? [] : [{ x: mid.x, y: mid.y, w: mid.w, h: mid.h }]
const fromRect = { x: top.x, y: top.y, w: top.w, h: top.h }
const toRect = { x: bottom.x, y: bottom.y, w: bottom.w, h: bottom.h }

const edgeProps = {
  id: 'drawn',
  source: 'top',
  target: 'bottom',
  sourceX: top.x + top.w / 2,
  sourceY: top.y + top.h,
  targetX: bottom.x + bottom.w / 2,
  targetY: bottom.y,
  sourcePosition: 'bottom',
  targetPosition: 'top',
  sourceHandleId: null,
  targetHandleId: null,
  selected: false,
  animated: false,
  interactionWidth: 20,
  data: { sync: 'idle', obstacles, fromRect, toRect },
  type: 'mindMap',
  markerEnd: undefined,
}

createRoot(document.getElementById('root')).render(
  <>
    <svg width={1200} height={900} style={{ position: 'absolute', inset: 0 }}>
      <MindMapEdge {...edgeProps} />
    </svg>
    {SCENE.cards.map(card => (
      <div key={card.id} data-mindmap-session={card.id}
        style={{ position: 'absolute', left: card.x, top: card.y,
          width: card.w, height: card.h, boxSizing: 'border-box',
          background: '#23262d', border: '1px solid #333a45', borderRadius: 10, color: '#cfd6e3' }}>
        <span style={{ fontSize: 11 }}>{card.id}</span>
      </div>
    ))}
  </>,
)
