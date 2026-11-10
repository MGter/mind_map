/** EOL-aware patch: drop markerEnd, insert the hand-drawn arrow. */
import fs from 'node:fs'

const file = 'src/client/MindMapEdge.tsx'
let source = fs.readFileSync(file, 'utf8')
const EOL = source.includes('\r\n') ? '\r\n' : '\n'
const J = (lines) => lines.join(EOL)
const before = source

// 1) markerEnd no longer trusted (React Flow markers never reach custom edges)
source = source.replace(
  J([
    '        path={path}',
    '        {...(props.markerEnd !== undefined ? { markerEnd: props.markerEnd } : {})}',
    '        style={{',
  ]),
  J(['        path={path}', '        style={{']),
)

// 2) arrow right after the base path
source = source.replace(
  J(['      />', '', '      {flying']),
  J([
    '      />',
    '',
    '      {/* Arrowhead drawn by hand: React Flow edge markers never reach a',
    '          custom edge component, which is why the line had no arrow. */}',
    '      <path',
    '        d="M0 0 L-11 -5 L-11 5 Z"',
    '        transform={`translate(${props.targetX} ${props.targetY}) rotate(${arrowAngle})`}',
    "        fill={synced ? 'rgba(232, 238, 250, 0.85)' : 'rgba(200, 206, 216, 0.5)'}",
    '        pointerEvents="none"',
    '      />',
    '',
    '      {flying',
  ]),
)

if (source === before) {
  console.error('nothing changed')
  process.exit(1)
}
fs.writeFileSync(file, source, 'utf8')
console.log('arrow wired (EOL ' + JSON.stringify(EOL) + ')')
