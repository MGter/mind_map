
import React from 'react'
import { createRoot } from 'react-dom/client'
import { ReactFlow, ReactFlowProvider, Background, Handle, Position, ConnectionMode, useReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { edgeTypes } from '../../src/client/MindMapEdge.tsx'

const SCENE = {"cards":[{"id":"top","x":0,"y":0,"w":224,"h":120},{"id":"mid","x":4,"y":176,"w":250,"h":129},{"id":"bottom","x":0,"y":361,"w":224,"h":120}]}
const CARD_W = 224
const CARD_H = 120

const nodeTypes = {
  card: ({ data }) => (
    <div data-mindmap-session={data.id} style={{ width: data.w, height: data.h, background: '#23262d',
      color: '#cfd6e3', border: '1px solid #333a45', borderRadius: 10, position: 'relative' }}>
      <Handle id="t" type="source" position={Position.Top} />
      <Handle id="r" type="source" position={Position.Right} />
      <Handle id="b" type="source" position={Position.Bottom} />
      <Handle id="l" type="source" position={Position.Left} />
      <span style={{ fontSize: 11 }}>{data.id}</span>
    </div>
  ),
}

function Canvas() {
  const [edges, setEdges] = React.useState([])
  const nodes = SCENE.cards.map(card => ({
    id: card.id, type: 'card', position: { x: card.x, y: card.y },
    data: { id: card.id, w: card.w, h: card.h },
    style: { width: card.w, height: card.h },
  }))

  const connect = (connection) => {
    const from = SCENE.cards.find(card => card.id === connection.source)
    const to = SCENE.cards.find(card => card.id === connection.target)
    const others = SCENE.cards.filter(card => card !== from && card !== to)
    setEdges(current => [...current, {
      id: 'drag-' + current.length,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle,
      targetHandle: connection.targetHandle,
      type: 'mindMap',
      data: {
        sync: 'idle',
        obstacles: others.map(card => ({ x: card.x, y: card.y, w: card.w, h: card.h })),
        fromRect: { x: from.x, y: from.y, w: from.w, h: from.h },
        toRect: { x: to.x, y: to.y, w: to.w, h: to.h },
      },
    }])
  }

  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
      connectionMode={ConnectionMode.Loose} onConnect={connect} fitView>
      <Background />
    </ReactFlow>
  )
}

createRoot(document.getElementById('root')).render(
  <ReactFlowProvider><Canvas /></ReactFlowProvider>,
)
