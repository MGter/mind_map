/**
 * The drawer must draw the SAME edges the canvas draws, with the same visibility
 * rule. It used to recompute from canvasState.edges, which (a) dropped lineage
 * edges entirely and (b) disagreed with the canvas about "synced".
 */
import fs from 'node:fs'

// ------------------------------------------------------------------ canvas ---
const canvasFile = 'src/client/MapCanvas.tsx'
let canvas = fs.readFileSync(canvasFile, 'utf8')
const D = canvas.includes('\r\n') ? '\r\n' : '\n'
const lines = canvas.split(/\r?\n/)

const start = lines.findIndex(line => line.includes('const drawerWireLinks = useMemo'))
if (start < 0) {
  console.error('drawerWireLinks missing')
  process.exit(1)
}
let end = start
while (end < lines.length && !lines[end].includes('}, [drawer, folderLayouts')) end += 1

const block = [
  '  const drawerWireLinks = useMemo(() => {',
  '    if (drawer === null) return []',
  '    // Same source of truth as the canvas: liveEdges already contains the',
  '    // derived fork lines, and already knows which ones count as in sync.',
  '    const layout = folderLayouts[drawer.groupId]',
  '    const inside = new Set(layout === undefined ? [] : [...layout.shown, ...layout.folded])',
  '    return liveEdges',
  '      .filter(edge => inside.has(edge.source) && inside.has(edge.target))',
  '      .map(edge => {',
  '        const data = (edge.data ?? {}) as { sync?: string; structural?: boolean }',
  '        // Identical rule to MindMapEdge: transfers vanish once in sync, fork',
  '        // lines never do.',
  '        const visible = !(data.sync === \'synced\' && data.structural !== true)',
  '        return { from: edge.source, to: edge.target, visible }',
  '      })',
  '  }, [drawer, folderLayouts, liveEdges])',
]
lines.splice(start, end - start + 1, ...block)
canvas = lines.join(D)

// drawerLinks() is now dead code
const cLines = canvas.split(/\r?\n/)
const fnAt = cLines.findIndex(line => line.includes('const drawerLinks = (cardIds'))
if (fnAt >= 0) {
  let from = fnAt
  while (from > 0 && !cLines[from - 1].trim().startsWith('/**')) from -= 1
  from -= 1
  let stop = fnAt
  while (stop < cLines.length && cLines[stop] !== '  }') stop += 1
  cLines.splice(from, stop - from + 1)
  canvas = cLines.join(D)
}
fs.writeFileSync(canvasFile, canvas, 'utf8')

// ------------------------------------------------------------------ drawer ---
const drawerFile = 'src/client/StackDrawer.tsx'
let drawer = fs.readFileSync(drawerFile, 'utf8')
const DD = drawer.includes('\r\n') ? '\r\n' : '\n'
const dLines = drawer.split(/\r?\n/)

// wire type: visibility instead of a sync flag
let typeAt = dLines.findIndex(line => line.includes('export interface DrawerWire'))
if (typeAt < 0) typeAt = dLines.findIndex(line => line.includes('/** One line to draw behind the drawer cards. */'))
if (typeAt < 0) {
  console.error('DrawerWire missing')
  process.exit(1)
}
let typeEnd = typeAt
while (typeEnd < dLines.length && dLines[typeEnd].trim() !== '}') typeEnd += 1
dLines.splice(typeAt, typeEnd - typeAt + 1, ...[
  '/** One line to draw behind the drawer cards. */',
  'export interface DrawerWire {',
  '  from: string',
  '  to: string',
  '  /** False = the canvas draws nothing for this pair, so neither do we. */',
  '  visible: boolean',
  '}',
])

// filter on visibility
let filterAt = dLines.findIndex(line => line.includes('.filter(link => !link.synced)'))
if (filterAt >= 0) {
  dLines[filterAt] = '    const links = (props.links ?? []).filter(link => link.visible)'
}

drawer = dLines.join(DD)
fs.writeFileSync(drawerFile, drawer, 'utf8')
console.log('drawer links now mirror liveEdges')
