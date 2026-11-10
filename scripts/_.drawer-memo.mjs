/** Rewrite the drawer link memo cleanly — the previous patch spliced it apart. */
import fs from 'node:fs'

const file = 'src/client/MapCanvas.tsx'
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)

const start = lines.findIndex(line => line.includes('const drawerWireLinks = useMemo'))
if (start < 0) {
  console.error('memo missing')
  process.exit(1)
}
// include the doc comment above it
let from = start
while (from > 0 && !lines[from - 1].trim().startsWith('/**')) from -= 1
from -= 1

let end = start
while (end < lines.length && !lines[end].includes('}, [drawer, folderLayouts')) end += 1

const block = [
  '  /**',
  '   * Links for the open drawer.',
  '   *',
  '   * Deliberately derived from `liveEdges`: that is exactly what the canvas is',
  '   * drawing, already filtered to the cards it actually paints and already',
  '   * carrying the sync state. Recomputing from canvasState.edges instead made',
  '   * the drawer disagree with the board in both directions (it drew lines the',
  '   * board hid, and missed the derived fork lines entirely).',
  '   */',
  '  const drawerWireLinks = useMemo(() => {',
  '    if (drawer === null) return []',
  '    const layout = folderLayouts[drawer.groupId]',
  '    const inFolder = new Set(layout === undefined ? [] : [...layout.shown, ...layout.folded])',
  '    const painted = new Set(Object.keys(visibleCards).filter(cardId => !foldedSet.has(cardId)))',
  '    return liveEdges',
  '      .filter(edge => painted.has(edge.source) && painted.has(edge.target)',
  '        && inFolder.has(edge.source) && inFolder.has(edge.target))',
  '      .map(edge => {',
  '        const data = (edge.data ?? {}) as { sync?: string; structural?: boolean }',
  '        // Same rule as MindMapEdge: transfers vanish once in sync, fork lines',
  '        // never do.',
  '        const visible = !(data.sync === \'synced\' && data.structural !== true)',
  '        return { from: edge.source, to: edge.target, visible }',
  '      })',
  '  }, [drawer, folderLayouts, liveEdges, visibleCards, foldedSet])',
]

lines.splice(from, end - from + 1, ...block)
fs.writeFileSync(file, lines.join('\n'), 'utf8')
console.log('memo rewritten')
