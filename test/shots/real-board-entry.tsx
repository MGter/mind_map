
import React from 'react'
import { createRoot } from 'react-dom/client'
import { ReactFlow, ReactFlowProvider, Background, Handle, Position, ConnectionMode } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { edgeTypes } from '../../src/client/MindMapEdge.tsx'
import { pickFaces } from '../../src/client/edge-routing.ts'

const CARD_W = 224
const CARD_H = 120
const scene = {"nodes":[{"id":"card-56cd5bbe-0ea6-4eb8-a78d-1aa39c84aebc","x":-288,"y":3806},{"id":"card-5caf9350-ac2f-4881-9e9e-b4db0b47146f","x":640,"y":190},{"id":"card-ae8eae95-9a80-4b8a-a24e-edd284c353eb","x":640,"y":366},{"id":"card-69708c8e-16eb-44a6-bd0c-a242afe355b2","x":-16,"y":3454},{"id":"card-cd367d3b-f781-4cd2-88bf-9e8d40a4d3fe","x":320,"y":-66},{"id":"card-991bd8e0-f415-450a-b347-187713dcd5d7","x":592,"y":-242},{"id":"card-ae9e3bfb-bdda-4ee9-9aa6-826d4ba7ef6a","x":592,"y":-66},{"id":"card-0a4bb8c3-39e8-4599-a845-c8db7cdeb995","x":864,"y":-66},{"id":"card-1a5b4c42-572b-41d9-84c8-a36453e6ebdf","x":336,"y":190},{"id":"card-3859d000-94bc-4a43-a71b-d63085790747","x":-16,"y":3630},{"id":"card-8a3865ce-60f1-495e-a0c4-d4b99862ff9e","x":-288,"y":3630},{"id":"card-9aed965b-0a19-4a52-a139-cf0bceb110bd","x":864,"y":-242},{"id":"card-6aea3b5a-821b-4f34-93c5-1077446d26e2","x":-16,"y":3278},{"id":"card-512321a8-ab27-45f4-b4fe-e12829dca493","x":-16,"y":3102},{"id":"card-681342a1-e033-4c0c-a054-e314816b8ac5","x":-288,"y":-242},{"id":"card-1a65b081-9512-4d90-82dd-1106b083b889","x":-16,"y":2926},{"id":"card-c2df9f41-29d5-489f-ac54-73c415fb37ac","x":-288,"y":3454},{"id":"card-b5b803cc-6ec0-499a-8646-e68f909cc18a","x":-288,"y":3278},{"id":"card-6cedebf6-a46d-4f7c-934c-e33f2e9ebc52","x":-288,"y":3102},{"id":"card-f0eb01a4-92d0-4b74-bfa9-533b6b29687e","x":-16,"y":-242},{"id":"card-80bd6fc0-be70-44b3-8bb2-caa3881d1cbd","x":-288,"y":2926},{"id":"card-0181ecf5-bb5d-44bb-998a-e23778b7844d","x":-16,"y":2750},{"id":"card-52270d26-55eb-44d1-bc54-f01f64d8658c","x":-288,"y":2750},{"id":"card-b613c046-907f-42a7-a04b-f3e7f3df89af","x":320,"y":-242},{"id":"card-cba9d4b1-78c1-48e5-b858-b80f12fbdc21","x":-288,"y":2574},{"id":"card-08793835-f37e-49b3-a998-8363f560902b","x":-16,"y":2574},{"id":"card-f2d8d855-7569-46c4-9454-c096b69177ce","x":-16,"y":2398},{"id":"card-4b844003-6bcf-4df6-b933-43606ebcdd12","x":-288,"y":2398},{"id":"card-922ffe25-bc5f-4e67-a8c7-d66d4423e224","x":-16,"y":2222},{"id":"card-90602518-c06f-4198-a42f-3773249afff5","x":-16,"y":1870},{"id":"card-9788b5d0-70a9-40dc-9318-a1661ed8f02f","x":-288,"y":2222},{"id":"card-c5b5cec1-13a3-44af-9a15-5b712a341053","x":992,"y":190},{"id":"card-5fe8bfd2-99a5-49a7-9ea9-26975f328df6","x":-16,"y":2046},{"id":"card-36dfcda1-8374-4e10-bf40-ee839958830b","x":-288,"y":-514},{"id":"card-2327435a-a8bc-46d3-b997-8903d1cc04a1","x":256,"y":-514},{"id":"card-8165bacf-05f0-4946-993b-6b4227963f34","x":528,"y":-514},{"id":"card-4fb0f01e-58fd-4c2e-8360-c7308a5b7e45","x":-16,"y":-514},{"id":"card-8cec676c-f020-4e6f-a0a7-d1a23537f6b2","x":992,"y":430},{"id":"card-28f5119d-a6de-4aa7-a1f5-ac521759008d","x":-288,"y":2046},{"id":"card-84510206-4a7e-4074-a8d7-20d13bd6974d","x":-16,"y":1694},{"id":"card-a954e169-0fab-4115-92f0-28d6295af7e1","x":-288,"y":1694},{"id":"card-8b4a001d-8e5d-4ada-ad5b-e31995b32663","x":-288,"y":1518},{"id":"card-3631b7a6-4205-46de-b35e-f35fb45ca476","x":-288,"y":1870},{"id":"card-cec6fe07-b0da-490c-b615-8dcd05cca17c","x":-640,"y":-66},{"id":"card-393c7e0a-8030-40f8-8ff8-bdd93ba344bc","x":-640,"y":110},{"id":"card-1a180ae2-8561-437c-90db-874afdf2b2f6","x":-640,"y":-242},{"id":"card-52563d83-f59b-429f-bdbf-b09a271a2592","x":-16,"y":1518},{"id":"card-d6787e2b-4965-41ef-8c70-dc0f62054728","x":-288,"y":1342},{"id":"card-c10c744d-82a7-4c41-999e-636435e7bf0b","x":-16,"y":286},{"id":"card-62fac7c1-fa66-4fc8-a426-4afb09ba16df","x":-16,"y":1342},{"id":"card-4dfba1fa-fa78-4150-ad7e-b97534f16600","x":-288,"y":1166},{"id":"card-f472c0aa-a409-4780-afcb-782401633ac3","x":-16,"y":1166},{"id":"card-9f6b0810-1cdc-49e2-b887-494e2c409748","x":336,"y":366},{"id":"card-d85c657d-b8c2-47c5-bc38-0ae1f7444de2","x":-16,"y":990},{"id":"card-a0d2ce1f-d325-4657-b413-09ff926b331e","x":336,"y":542},{"id":"card-2c77af12-d9c0-4bb6-b5ad-58119f4f9248","x":-288,"y":-66},{"id":"card-36990792-02b6-476e-9c9c-68afacfb2227","x":-16,"y":814},{"id":"card-9b85b1a1-0957-4c48-8a4d-5386eb096059","x":-288,"y":990},{"id":"card-ab30db99-37fa-4acc-bd52-43cdb0d3b00f","x":-288,"y":814},{"id":"card-cb542bc8-7b61-4b03-a1e0-e8672e055aed","x":-16,"y":638},{"id":"card-f5d116ac-a487-4bea-b433-bd018147c292","x":-288,"y":638},{"id":"card-d2bec7a5-dff0-4e5e-b444-d33f8534caff","x":-16,"y":462},{"id":"card-8b9a8f1d-1f3d-4e1b-a05f-0911b014fb4f","x":-16,"y":110},{"id":"card-cdcc7d48-d06e-4bf2-a686-8f9dd9cdb48b","x":-288,"y":462},{"id":"card-24c57be8-a7db-4435-97e6-6942db195e02","x":-288,"y":110},{"id":"card-d338f835-6554-43f1-833f-5325da1dee72","x":-288,"y":286},{"id":"card-5da2c2c6-6e43-4f7c-af13-fec6f3684caa","x":-16,"y":-66}],"pairs":[["card-681342a1-e033-4c0c-a054-e314816b8ac5","card-f0eb01a4-92d0-4b74-bfa9-533b6b29687e"],["card-681342a1-e033-4c0c-a054-e314816b8ac5","card-2c77af12-d9c0-4bb6-b5ad-58119f4f9248"],["card-681342a1-e033-4c0c-a054-e314816b8ac5","card-5da2c2c6-6e43-4f7c-af13-fec6f3684caa"],["card-681342a1-e033-4c0c-a054-e314816b8ac5","card-24c57be8-a7db-4435-97e6-6942db195e02"],["card-681342a1-e033-4c0c-a054-e314816b8ac5","card-8b9a8f1d-1f3d-4e1b-a05f-0911b014fb4f"],["card-f0eb01a4-92d0-4b74-bfa9-533b6b29687e","card-2c77af12-d9c0-4bb6-b5ad-58119f4f9248"],["card-f0eb01a4-92d0-4b74-bfa9-533b6b29687e","card-5da2c2c6-6e43-4f7c-af13-fec6f3684caa"],["card-f0eb01a4-92d0-4b74-bfa9-533b6b29687e","card-24c57be8-a7db-4435-97e6-6942db195e02"],["card-f0eb01a4-92d0-4b74-bfa9-533b6b29687e","card-8b9a8f1d-1f3d-4e1b-a05f-0911b014fb4f"],["card-2c77af12-d9c0-4bb6-b5ad-58119f4f9248","card-5da2c2c6-6e43-4f7c-af13-fec6f3684caa"],["card-2c77af12-d9c0-4bb6-b5ad-58119f4f9248","card-24c57be8-a7db-4435-97e6-6942db195e02"],["card-2c77af12-d9c0-4bb6-b5ad-58119f4f9248","card-8b9a8f1d-1f3d-4e1b-a05f-0911b014fb4f"],["card-5da2c2c6-6e43-4f7c-af13-fec6f3684caa","card-24c57be8-a7db-4435-97e6-6942db195e02"],["card-5da2c2c6-6e43-4f7c-af13-fec6f3684caa","card-8b9a8f1d-1f3d-4e1b-a05f-0911b014fb4f"],["card-24c57be8-a7db-4435-97e6-6942db195e02","card-8b9a8f1d-1f3d-4e1b-a05f-0911b014fb4f"],["card-b613c046-907f-42a7-a04b-f3e7f3df89af","card-991bd8e0-f415-450a-b347-187713dcd5d7"],["card-b613c046-907f-42a7-a04b-f3e7f3df89af","card-9aed965b-0a19-4a52-a139-cf0bceb110bd"],["card-b613c046-907f-42a7-a04b-f3e7f3df89af","card-cd367d3b-f781-4cd2-88bf-9e8d40a4d3fe"],["card-b613c046-907f-42a7-a04b-f3e7f3df89af","card-ae9e3bfb-bdda-4ee9-9aa6-826d4ba7ef6a"],["card-b613c046-907f-42a7-a04b-f3e7f3df89af","card-0a4bb8c3-39e8-4599-a845-c8db7cdeb995"],["card-991bd8e0-f415-450a-b347-187713dcd5d7","card-9aed965b-0a19-4a52-a139-cf0bceb110bd"],["card-991bd8e0-f415-450a-b347-187713dcd5d7","card-cd367d3b-f781-4cd2-88bf-9e8d40a4d3fe"],["card-991bd8e0-f415-450a-b347-187713dcd5d7","card-ae9e3bfb-bdda-4ee9-9aa6-826d4ba7ef6a"],["card-991bd8e0-f415-450a-b347-187713dcd5d7","card-0a4bb8c3-39e8-4599-a845-c8db7cdeb995"],["card-9aed965b-0a19-4a52-a139-cf0bceb110bd","card-cd367d3b-f781-4cd2-88bf-9e8d40a4d3fe"],["card-9aed965b-0a19-4a52-a139-cf0bceb110bd","card-ae9e3bfb-bdda-4ee9-9aa6-826d4ba7ef6a"],["card-9aed965b-0a19-4a52-a139-cf0bceb110bd","card-0a4bb8c3-39e8-4599-a845-c8db7cdeb995"],["card-cd367d3b-f781-4cd2-88bf-9e8d40a4d3fe","card-ae9e3bfb-bdda-4ee9-9aa6-826d4ba7ef6a"],["card-cd367d3b-f781-4cd2-88bf-9e8d40a4d3fe","card-0a4bb8c3-39e8-4599-a845-c8db7cdeb995"],["card-ae9e3bfb-bdda-4ee9-9aa6-826d4ba7ef6a","card-0a4bb8c3-39e8-4599-a845-c8db7cdeb995"],["card-681342a1-e033-4c0c-a054-e314816b8ac5","card-36dfcda1-8374-4e10-bf40-ee839958830b"],["card-681342a1-e033-4c0c-a054-e314816b8ac5","card-1a5b4c42-572b-41d9-84c8-a36453e6ebdf"],["card-681342a1-e033-4c0c-a054-e314816b8ac5","card-1a180ae2-8561-437c-90db-874afdf2b2f6"],["card-681342a1-e033-4c0c-a054-e314816b8ac5","card-5caf9350-ac2f-4881-9e9e-b4db0b47146f"]]}

const nodeTypes = {
  card: ({ data }) => (
    <div data-mindmap-session={data.id} style={{ width: CARD_W, height: CARD_H, boxSizing: 'content-box', padding: '10px 12px', border: '1px solid #333a45', background: '#23262d',
      color: '#cfd6e3', border: '1px solid #333a45', borderRadius: 10 }}>
      <Handle id="t" type="source" position={Position.Top} />
      <Handle id="r" type="source" position={Position.Right} />
      <Handle id="b" type="source" position={Position.Bottom} />
      <Handle id="l" type="source" position={Position.Left} />
    </div>
  ),
}

const placed = scene.nodes
const rectOf = id => { const p = placed.find(n => n.id === id); return { x: p.x, y: p.y, w: CARD_W, h: CARD_H } }
const nodes = scene.nodes.map(n => ({ id: n.id, type: 'card', position: { x: n.x, y: n.y }, data: { id: n.id } }))
const edges = scene.pairs.map(([from, to], index) => {
  const faces = pickFaces({ id: from, x: rectOf(from).x, y: rectOf(from).y },
    { id: to, x: rectOf(to).x, y: rectOf(to).y },
    placed.map(n => ({ id: n.id, x: n.x, y: n.y })), { cardWidth: CARD_W, cardHeight: CARD_H })
  return {
    id: 'e' + index, source: from, target: to, type: 'mindMap',
    sourceHandle: faces.fromHandle, targetHandle: faces.toHandle,
    data: {
      sync: 'idle',
      // the painted card is content-box: 224+24+2 wide, 120 bounded below by content
      obstacles: placed.filter(n => n.id !== from && n.id !== to).map(n => ({ x: n.x, y: n.y, w: CARD_W + 26, h: CARD_H + 9 })),
      fromRect: { ...rectOf(from), w: CARD_W + 26, h: CARD_H + 9 }, toRect: { ...rectOf(to), w: CARD_W + 26, h: CARD_H + 9 },
    },
  }
})

function App() {
  const [, setTick] = React.useState(0)
  React.useEffect(() => { const id = setTimeout(() => setTick(v => v + 1), 300); return () => clearTimeout(id) }, [])
  return (
    <ReactFlowProvider>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Loose} fitView>
        <Background />
      </ReactFlow>
    </ReactFlowProvider>
  )
}
createRoot(document.getElementById('root')).render(<App />)
