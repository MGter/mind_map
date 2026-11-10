
import React from 'react'
import { createRoot } from 'react-dom/client'
import { ReactFlowProvider, ReactFlow } from '@xyflow/react'
import { MindMapEdge, edgeTypes } from '../../src/client/MindMapEdge.tsx'

const W = 224
const H = 120
const GX = 48
const GY = 56
const COLS = 3
const ROWS = 3

const cards = []
for (let row = 0; row < ROWS; row += 1) {
  for (let col = 0; col < COLS; col += 1) {
    cards.push({ id: 'c' + row + col, x: col * (W + GX), y: row * (H + GY), w: W, h: H })
  }
}

const boxOf = id => cards.find(card => card.id === id)
const anchor = (card, face) => face === 't' ? { x: card.x + card.w / 2, y: card.y }
  : face === 'b' ? { x: card.x + card.w / 2, y: card.y + card.h }
    : face === 'l' ? { x: card.x, y: card.y + card.h / 2 }
      : { x: card.x + card.w, y: card.y + card.h / 2 }
const position = face => face === 't' ? 'top' : face === 'b' ? 'bottom' : face === 'l' ? 'left' : 'right'

// Pairs that force lines into the same gutters, plus one ordinary neighbour link.
const LINKS = [
  ['c00', 'c22', 'r', 'l'],
  ['c10', 'c01', 't', 'b'],
  ['c20', 'c02', 'r', 'l'],
  ['c00', 'c01', 'r', 'l'],
  ['c11', 'c21', 'b', 'b'],
  ['c12', 'c02', 'l', 'r'],
]

const obstacles = cards.map(card => ({ x: card.x, y: card.y, w: card.w, h: card.h }))

const edges = LINKS.map(([from, to, fromFace, toFace], index) => {
  const a = boxOf(from)
  const b = boxOf(to)
  const start = anchor(a, fromFace)
  const end = anchor(b, toFace)
  return {
    id: 'e' + index,
    source: from,
    target: to,
    type: 'mindMap',
    sourcePosition: position(fromFace),
    targetPosition: position(toFace),
    data: {
      sync: 'idle',
      obstacles,
      fromRect: a,
      toRect: b,
      sourceX: start.x,
      sourceY: start.y,
      targetX: end.x,
      targetY: end.y,
    },
  }
})

const nodes = cards.map(card => ({
  id: card.id,
  position: { x: card.x, y: card.y },
  data: { label: card.id },
  type: 'default',
  style: { width: card.w, height: card.h, background: '#23262d', border: '1px solid #333a45',
    borderRadius: 10, color: '#cfd6e3', fontSize: 12 },
}))

// MindMapEdge gets its coordinates from React Flow; mirror them onto the node handles.
const withHandles = edges.map(edge => {
  const a = boxOf(edge.source)
  const b = boxOf(edge.target)
  const start = anchor(a, edge.sourcePosition === 'right' ? 'r' : edge.sourcePosition === 'left' ? 'l' : edge.sourcePosition === 'top' ? 't' : 'b')
  const end = anchor(b, edge.targetPosition === 'right' ? 'r' : edge.targetPosition === 'left' ? 'l' : edge.targetPosition === 'top' ? 't' : 'b')
  return {
    ...edge,
    data: { ...edge.data, sourceX: start.x, sourceY: start.y, targetX: end.x, targetY: end.y },
  }
})

function Scene() {
  return React.createElement(ReactFlowProvider, null,
    React.createElement('div', { style: { width: 1100, height: 620, position: 'relative' } },
      React.createElement(ReactFlow, {
        nodes,
        edges: withHandles,
        edgeTypes,
        fitView: false,
        proOptions: { hideAttribution: true },
        nodeOrigin: [0, 0],
        defaultViewport: { x: 20, y: 20, zoom: 1 },
      })))
}

createRoot(document.getElementById('root')).render(React.createElement(Scene))
