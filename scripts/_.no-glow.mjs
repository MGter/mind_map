/**
 * 同步中 = 线不可见（opacity 0），未同步 = 灰色虚线。不再发光。
 */
import fs from 'node:fs'

const file = 'src/client/MindMapEdge.tsx'
const content = `/**
 * One edge renderer for the whole map.
 *
 * 未同步 → 灰色虚线，看得见。
 * 同步中 → 整条线透明度 0，看不见（东西已经到位，不需要再提示）。
 *
 * 没有发光、没有流光、没有粒子：线要么在，要么不在。箭头跟着线一起隐藏。
 */
import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react'

export interface MindMapEdgeData {
  fromCardId?: string
  toCardId?: string
  sync?: 'synced' | 'idle'
}

export function MindMapEdge(props: EdgeProps): React.JSX.Element {
  const data = (props.data ?? {}) as MindMapEdgeData
  const synced = data.sync === 'synced'
  const [path] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
  })

  /**
   * Which way the arrow points: the path arrives at the target handle, so the
   * head follows that face (left → pointing right, top → pointing down, …).
   */
  const arrowAngle = (() => {
    const position = String(props.targetPosition ?? 'left')
    if (position === 'right') return 180
    if (position === 'top') return 90
    if (position === 'bottom') return -90
    return 0
  })()

  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        style={{
          stroke: 'rgba(200, 206, 216, 0.45)',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          strokeDasharray: '6 5',
          // Synced: the line simply is not there any more.
          opacity: synced ? 0 : 1,
        }}
      />

      <path
        d="M0 0 L-11 -5 L-11 5 Z"
        transform={\`translate(\${props.targetX} \${props.targetY}) rotate(\${arrowAngle})\`}
        fill="rgba(200, 206, 216, 0.5)"
        opacity={synced ? 0 : 1}
        pointerEvents="none"
      />
    </>
  )
}

export const edgeTypes = { mindMap: MindMapEdge }
`
fs.writeFileSync(file, content, 'utf8')

// Drawer: a synced pair draws nothing either.
const drawerFile = 'src/client/StackDrawer.tsx'
let drawer = fs.readFileSync(drawerFile, 'utf8')
const D = drawer.includes('\r\n') ? '\r\n' : '\n'
const J = (lines) => lines.join(D)
drawer = drawer.replace(
  J(['    const links = props.links ?? []']),
  J([
    '    // Synced pairs show no line at all, same as on the map.',
    '    const links = (props.links ?? []).filter(link => !link.synced)',
  ]),
)
drawer = drawer.replace(
  J(['          {wires.length > 0']),
  J(['          {wires.length > 0']),
)
// the glow layer inside the drawer svg is pointless now
drawer = drawer.replace(
  J([
    '                    <g key={index}>',
    '                      {wire.synced',
    '                        ? (',
    '                            <path',
    '                              d={wire.d}',
    '                              fill="none"',
    '                              stroke="rgba(196, 219, 255, 0.5)"',
    '                              strokeWidth={6}',
    '                              strokeLinecap="round"',
    "                              style={{ filter: 'blur(3.5px)' }}",
    '                            />',
    '                          )',
    '                        : null}',
  ]),
  J(['                    <g key={index}>']),
)
fs.writeFileSync(drawerFile, drawer, 'utf8')
console.log('no glow, synced = invisible')
