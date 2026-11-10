/**
 * 抽屉里的连线改用和画布同一个折线算法（getSmoothStepPath），不再是贝塞尔弯曲线。
 */
import fs from 'node:fs'

const file = 'src/client/StackDrawer.tsx'
let source = fs.readFileSync(file, 'utf8')
const D = source.includes('\r\n') ? '\r\n' : '\n'
const before = source

// 1) import
if (!source.includes("import { getSmoothStepPath, Position } from '@xyflow/react'")) {
  source = source.replace(
    "import styles from './mind-map.module.css'",
    "import { getSmoothStepPath, Position } from '@xyflow/react'" + D + "import styles from './mind-map.module.css'",
  )
}

// 2) 用同一套折线算法重写几何段
const lines = source.split(/\r?\n/)
const startAt = lines.findIndex(line => line.includes('// Same rule as the map: a facing-side line needs room'))
if (startAt < 0) {
  console.error('geometry block missing')
  process.exit(1)
}
let endAt = startAt
while (endAt < lines.length && !lines[endAt].trim().startsWith('next.push({')) endAt += 1
while (endAt < lines.length && lines[endAt].trim() !== '}') endAt += 1

const block = [
  '        // Same rule and the same geometry as the map: an orthogonal smoothstep',
  '        // path (rounded right angles), not a bezier bow.',
  '        const gapX = Math.abs(dx) - (from.width + to.width) / 2',
  '        const gapY = Math.abs(dy) - (from.height + to.height) / 2',
  '        const MIN_SPAN = 96',
  '        const horizontalDominant = Math.abs(dx) >= Math.abs(dy)',
  '',
  '        let sourceX = fromCx',
  '        let sourceY = fromCy',
  '        let targetX = toCx',
  '        let targetY = toCy',
  '        let sourcePosition = Position.Right',
  '        let targetPosition = Position.Left',
  '',
  '        if (horizontalDominant && gapX >= MIN_SPAN) {',
  '          const right = dx >= 0',
  '          sourceX = right ? from.x + from.width : from.x',
  '          targetX = right ? to.x : to.x + to.width',
  '          sourcePosition = right ? Position.Right : Position.Left',
  '          targetPosition = right ? Position.Left : Position.Right',
  '          targetY = toCy',
  '        } else if (!horizontalDominant && gapY >= MIN_SPAN) {',
  '          const down = dy >= 0',
  '          sourceY = down ? from.y + from.height : from.y',
  '          targetY = down ? to.y : to.y + to.height',
  '          sourcePosition = down ? Position.Bottom : Position.Top',
  '          targetPosition = down ? Position.Top : Position.Bottom',
  '          targetX = toCx',
  '        } else {',
  '          // Too close: drop out of the bottom (or top) of both cards.',
  '          const down = from.y + from.height <= to.y + to.height',
  '          sourceY = down ? from.y + from.height : from.y',
  '          targetY = down ? to.y + to.height : to.y',
  '          sourcePosition = down ? Position.Bottom : Position.Top',
  '          targetPosition = down ? Position.Bottom : Position.Top',
  '        }',
  '',
  '        const [wirePath] = getSmoothStepPath({',
  '          sourceX,',
  '          sourceY,',
  '          sourcePosition,',
  '          targetX,',
  '          targetY,',
  '          targetPosition,',
  '          borderRadius: 8,',
  '        })',
  '',
  '        const angle = targetPosition === Position.Left ? 0',
  '          : targetPosition === Position.Right ? 180',
  '            : targetPosition === Position.Top ? 90',
  '              : -90',
  '        next.push({ d: wirePath, ax: targetX, ay: targetY, angle })',
  '      }',
]

lines.splice(startAt, endAt - startAt + 1, ...block)

fs.writeFileSync(file, lines.join(D), 'utf8')
console.log('drawer wires: smoothstep like the map')
