/**
 * Map edges: give each edge a small lane offset inside its corridor so two edges that share
 * a gap no longer run side by side as one doubled line.
 */
import fs from 'node:fs'

const route = 'src/client/edge-route.ts'
let text = fs.readFileSync(route, 'utf8')

text = text.replace(
  'export function snapToChannels(\n  points: Point[],\n  obstacles: readonly Rect[],\n  margin: number,\n): Point[] {',
  'export function snapToChannels(\n  points: Point[],\n  obstacles: readonly Rect[],\n  margin: number,\n  offset = 0,\n): Point[] {',
)

text = text.replace(
  '  const centre = centreFor(horizontalRun, horizontalRun ? a.y : a.x, lo, hi)\n  if (centre === undefined) continue',
  '  const centre = centreFor(horizontalRun, horizontalRun ? a.y : a.x, lo, hi)\n  if (centre === undefined) continue\n  // A small stable shift inside the corridor: two edges in the same gap keep their own\n  // line instead of drawing one doubled line.\n  const shift = Math.max(-2.5, Math.min(2.5, offset))',
)
text = text.replace(
  '  if (horizontalRun) {\n    if (Math.abs(centre - a.y) < 0.6) continue\n    a.y = centre\n    b.y = centre\n  } else {\n    if (Math.abs(centre - a.x) < 0.6) continue\n    a.x = centre\n    b.x = centre\n  }',
  '  if (horizontalRun) {\n    const target = centre + shift\n    if (Math.abs(target - a.y) < 0.6) continue\n    a.y = target\n    b.y = target\n  } else {\n    const target = centre + shift\n    if (Math.abs(target - a.x) < 0.6) continue\n    a.x = target\n    b.x = target\n  }',
)

// RouteOptions + threading
text = text.replace(
  '  minCorridor?: number\n}',
  '  minCorridor?: number\n  /** Stable per-edge shift inside the corridor, so edges sharing a gap stay apart. */\n  laneOffset?: number\n}',
)
text = text.replace(
  'snapToChannels(points, [from, to, ...obstacles] as Rect[], margin)',
  'snapToChannels(points, [from, to, ...obstacles] as Rect[], margin, options.laneOffset ?? 0)',
)
fs.writeFileSync(route, text, 'utf8')

// The map edge passes its own offset.
const edge = 'src/client/MindMapEdge.tsx'
let tsx = fs.readFileSync(edge, 'utf8')
if (!tsx.includes('laneOffset')) {
  tsx = tsx.replace(
    '      merged,\n    )',
    '      merged,\n      { laneOffset },\n    )',
  )
  tsx = tsx.replace(
    '  const route = data.fromRect === undefined || data.toRect === undefined',
    '  // Stable per-edge lane offset: two edges in the same gap would otherwise draw the\n  // same line twice.\n  const laneOffset = (() => {\n    let hash = 7\n    for (const character of String(props.id)) hash = (hash * 31 + character.charCodeAt(0)) % 997\n    return ((hash % 5) - 2) * 1.2\n  })()\n\n  const route = data.fromRect === undefined || data.toRect === undefined',
  )
}
fs.writeFileSync(edge, tsx, 'utf8')
console.log('lane offset wired')
