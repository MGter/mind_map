/** Hand-drawn arrowhead + brighter sparks + sweep direction. */
import fs from 'node:fs'

const file = 'src/client/MindMapEdge.tsx'
let source = fs.readFileSync(file, 'utf8')
const before = source

// 1) drop the marker pass-through (React Flow markers never reach custom edges)
source = source.replace(
  `      <BaseEdge\n        id={props.id}\n        path={path}\n        {...(props.markerEnd !== undefined ? { markerEnd: props.markerEnd } : {})}\n        style={{`,
  `      <BaseEdge\n        id={props.id}\n        path={path}\n        style={{`,
)

// 2) arrowhead angle, computed from the target handle
source = source.replace(
  '  const flying = synced && !prefersReducedMotion()',
  `  const flying = synced && !prefersReducedMotion()\n\n  /**\n   * Which way the arrow points. The path arrives at the target handle, so the\n   * head follows that face: left → pointing right, top → pointing down, …\n   * React Flow's own edge markers never reach a custom edge component, which is\n   * why the line had lost its arrow entirely.\n   */\n  const arrowAngle = (() => {\n    const position = String(props.targetPosition ?? 'left')\n    if (position === 'right') return 180\n    if (position === 'top') return 90\n    if (position === 'bottom') return -90\n    return 0\n  })()`,
)

// 3) draw the arrow right after the base path
source = source.replace(
  `      />\n\n      {flying\n`,
  `      />\n\n      <path\n        d="M0 0 L-11 -5 L-11 5 Z"\n        transform={\`translate(\${props.targetX} \${props.targetY}) rotate(\${arrowAngle})\`}\n        fill={synced ? 'rgba(232, 238, 250, 0.85)' : 'rgba(200, 206, 216, 0.5)'}\n        pointerEvents="none"\n      />\n\n      {flying\n`,
)

// 4) sparks: brighter, bigger, tighter halo
source = source.replace('    r: 2 + 2 * noise(seed, index + 21),', '    r: 2.6 + 2 * noise(seed, index + 21),')
source = source.replace('    opacity: 0.5 + 0.45 * noise(seed, index + 31),', '    opacity: 0.85 + 0.15 * noise(seed, index + 31),')
source = source.replace('    blur: 0.3 + 0.6 * noise(seed, index + 41),', '    blur: 0.15 + 0.35 * noise(seed, index + 41),')
source = source.replace(
  '<stop offset="45%" stopColor="rgba(214, 232, 255, 0.5)" />',
  '<stop offset="42%" stopColor="rgba(226, 240, 255, 0.75)" />',
)

if (source === before) {
  console.error('nothing changed')
  process.exit(1)
}
fs.writeFileSync(file, source, 'utf8')
console.log('edge: arrow + brighter sparks')
