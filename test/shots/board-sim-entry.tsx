
import { createRoot } from 'react-dom/client'
import { ReactFlow, ReactFlowProvider, Background, Handle, Position, ConnectionMode } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { edgeTypes } from '../../src/client/MindMapEdge.tsx'
import { pickFaces } from '../../src/client/edge-routing.ts'

const CARD_W = 224
const CARD_H = 120
const scene = {"nodes":[{"id":"card-36dfcda1-8374-4e10-bf40-ee839958830b","x":-288,"y":-514},{"id":"card-2327435a-a8bc-46d3-b997-8903d1cc04a1","x":256,"y":-514},{"id":"card-8165bacf-05f0-4946-993b-6b4227963f34","x":528,"y":-514},{"id":"card-4fb0f01e-58fd-4c2e-8360-c7308a5b7e45","x":-16,"y":-514}],"pairs":[["card-36dfcda1-8374-4e10-bf40-ee839958830b","card-2327435a-a8bc-46d3-b997-8903d1cc04a1"],["card-36dfcda1-8374-4e10-bf40-ee839958830b","card-8165bacf-05f0-4946-993b-6b4227963f34"],["card-36dfcda1-8374-4e10-bf40-ee839958830b","card-4fb0f01e-58fd-4c2e-8360-c7308a5b7e45"],["card-2327435a-a8bc-46d3-b997-8903d1cc04a1","card-8165bacf-05f0-4946-993b-6b4227963f34"],["card-2327435a-a8bc-46d3-b997-8903d1cc04a1","card-4fb0f01e-58fd-4c2e-8360-c7308a5b7e45"],["card-8165bacf-05f0-4946-993b-6b4227963f34","card-4fb0f01e-58fd-4c2e-8360-c7308a5b7e45"]]}

const nodeTypes = {
  card: ({ data }) => (
    <div data-card-id={data.id} data-mindmap-session={data.id} style={{ width: CARD_W, height: CARD_H, background: '#23262d', color: '#cfd6e3',
      border: '1px solid #333a45', borderRadius: 10 }}>
      <Handle id="t" type="source" position={Position.Top} />
      <Handle id="r" type="source" position={Position.Right} />
      <Handle id="b" type="source" position={Position.Bottom} />
      <Handle id="l" type="source" position={Position.Left} />
      <span style={{ fontSize: 11 }}>{data.id.slice(-4)}</span>
    </div>
  ),
}

const placed = scene.nodes
const rectOf = id => { const p = placed.find(n => n.id === id); return { x: p.x, y: p.y, w: CARD_W, h: CARD_H } }

const nodes = scene.nodes.map(n => ({
  id: n.id, type: 'card', position: { x: n.x, y: n.y }, data: { id: n.id },
  style: { width: CARD_W, height: CARD_H },
}))

const edges = scene.pairs.map(([from, to], index) => {
  const faces = pickFaces({ id: from, x: rectOf(from).x, y: rectOf(from).y },
    { id: to, x: rectOf(to).x, y: rectOf(to).y },
    placed.map(n => ({ id: n.id, x: n.x, y: n.y })), { cardWidth: CARD_W, cardHeight: CARD_H })
  return {
    id: 'e' + index, source: from, target: to, type: 'mindMap',
    sourceHandle: faces.fromHandle, targetHandle: faces.toHandle,
    data: {
      sync: 'idle',
      // deliberately empty: the renderer must fall back to measuring the DOM
      obstacles: [],
      fromRect: rectOf(from), toRect: rectOf(to),
    },
  }
})

createRoot(document.getElementById('root')).render(
  <ReactFlowProvider>
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
      connectionMode={ConnectionMode.Loose} fitView>
      <Background />
    </ReactFlow>
  </ReactFlowProvider>,
)
