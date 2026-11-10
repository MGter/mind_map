/** Use the custom edge renderer; the look lives in the component, not in CSS. */
import fs from 'node:fs'

const file = 'src/client/MapCanvas.tsx'
let source = fs.readFileSync(file, 'utf8')
const EOL = source.includes('\r\n') ? '\r\n' : '\n'
const J = (lines) => lines.join(EOL)

// ---- import ------------------------------------------------------------
if (!source.includes("from './MindMapEdge.tsx'")) {
  source = source.replace(
    "import { ContextMenu, type MenuItem, type MenuState } from './ContextMenu.tsx'",
    "import { ContextMenu, type MenuItem, type MenuState } from './ContextMenu.tsx'" + EOL + "import { edgeTypes } from './MindMapEdge.tsx'",
  )
}

// ---- stored edges: custom type + sync in data -------------------------
source = source.replace(
  J([
    '      out.push({',
    '        // Two looks only: the packet runs while in sync, otherwise plain dashes.',
    "        className: `tmEdge ${sync === 'synced' ? 'tmEdge-synced' : 'tmEdge-idle'}`,",
    '        id: edgeId,',
    '        source: edge.fromCardId,',
    '        target: edge.toCardId,',
    '        // Handles stored per edge; legacy edges keep their old r→l anchoring.',
    "        sourceHandle: edge.fromHandle ?? 'r',",
    "        targetHandle: edge.toHandle ?? 'l',",
    "        type: 'smoothstep',",
  ]),
  J([
    '      out.push({',
    '        id: edgeId,',
    '        source: edge.fromCardId,',
    '        target: edge.toCardId,',
    '        // Handles stored per edge; legacy edges keep their old r→l anchoring.',
    "        sourceHandle: edge.fromHandle ?? 'r',",
    "        targetHandle: edge.toHandle ?? 'l',",
    '        type: MIND_MAP_EDGE_TYPE,',
  ]),
)
source = source.replace(
  J([
    '        // Endpoints ride along for the edge context menu (id parsing would',
    '        // be ambiguous — card ids contain dashes).',
    '        data: { fromCardId: edge.fromCardId, toCardId: edge.toCardId },',
  ]),
  J([
    '        // Endpoints ride along for the edge context menu (id parsing would',
    '        // be ambiguous — card ids contain dashes); `sync` drives the look.',
    '        data: { fromCardId: edge.fromCardId, toCardId: edge.toCardId, sync },',
  ]),
)

// ---- lineage edges -----------------------------------------------------
source = source.replace(
  J([
    "        type: 'smoothstep',",
    '        selectable: false,',
  ]),
  J([
    '        type: MIND_MAP_EDGE_TYPE,',
  ]),
)
source = source.replace(
  J([
    '        // Same two looks as any other line.',
    "        className: `tmEdge ${lineageSync === 'synced' ? 'tmEdge-synced' : 'tmEdge-idle'}`,",
  ]),
  J([
    '        // Same two looks as any other line.',
  ]),
)
source = source.replace(
  J([
    '        data: { fromCardId: parentCardId, toCardId: cardId },',
    '        // No inline stroke here: inline style beats the stylesheet, which is why',
    '        // the lineage line ignored every class-based look.',
    '        style: { opacity: 0.5 },',
  ]),
  J([
    '        data: { fromCardId: parentCardId, toCardId: cardId, sync: lineageSync },',
    '        // No inline stroke: inline style beats everything the renderer draws.',
    '        style: { opacity: 0.85 },',
  ]),
)

// ---- path edges (they are NOT edges; ReactFlow needs the map) ---------
source = source.replace(
  J([
    '        <ReactFlow',
    '          nodes={nodes}',
    '          edges={edges}',
  ]),
  J([
    '        <ReactFlow',
    '          nodes={nodes}',
    '          edges={edges}',
    '          edgeTypes={edgeTypes}',
  ]),
)

// ---- the constant ------------------------------------------------------
source = source.replace(
  J(['const CARD_W =']),
  J([
    "/** Registered in `edgeTypes`: the map's only edge renderer. */",
    "const MIND_MAP_EDGE_TYPE = 'mindMap'",
    '',
    'const CARD_W =',
  ]),
)

fs.writeFileSync(file, source, 'utf8')
console.log('custom edge renderer wired')
