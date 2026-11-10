/**
 * Fix the drawer wires:
 *  - size the layer in content pixels (no viewBox scaling — that was stretching
 *    the paths over the visible box and is what looked like random lines);
 *  - same look as the map: grey dashed line, hidden when synced, arrow at the end.
 */
import fs from 'node:fs'

const file = 'src/client/StackDrawer.tsx'
let source = fs.readFileSync(file, 'utf8')
const D = source.includes('\r\n') ? '\r\n' : '\n'
const J = (lines) => lines.join(D)
const before = source

// 1) wire carries the arrow head geometry too
source = source.replace(
  '  const [wires, setWires] = useState<{ d: string; synced: boolean }[]>([])',
  '  const [wires, setWires] = useState<{ d: string; ax: number; ay: number; angle: number }[]>([])',
)
source = source.replace(
  '      const next: { d: string; synced: boolean }[] = []',
  '      const next: { d: string; ax: number; ay: number; angle: number }[] = []',
)
source = source.replace(
  J([
    '          next.push({',
    "            d: `M ${x1} ${y1} C ${x1 + bend * sign} ${y1}, ${x2 - bend * sign} ${y2}, ${x2} ${y2}`,",
    '            synced: link.synced,',
    '          })',
  ]),
  J([
    '          next.push({',
    "            d: `M ${x1} ${y1} C ${x1 + bend * sign} ${y1}, ${x2 - bend * sign} ${y2}, ${x2} ${y2}`,",
    '            ax: x2,',
    '            ay: y2,',
    '            angle: dx >= 0 ? 0 : 180,',
    '          })',
  ]),
)
source = source.replace(
  J([
    '          next.push({',
    "            d: `M ${x1} ${y1} C ${x1} ${y1 + bend * sign}, ${x2} ${y2 - bend * sign}, ${x2} ${y2}`,",
    '            synced: link.synced,',
    '          })',
  ]),
  J([
    '          next.push({',
    "            d: `M ${x1} ${y1} C ${x1} ${y1 + bend * sign}, ${x2} ${y2 - bend * sign}, ${x2} ${y2}`,",
    '            ax: x2,',
    '            ay: y2,',
    '            angle: dy >= 0 ? 90 : -90,',
    '          })',
  ]),
)

// 2) the "unchanged" comparison must ignore the new fields' identity
source = source.replace(
  '        if (current.length === next.length && current.every((wire, index) => wire.d === next[index]?.d && wire.synced === next[index]?.synced)) {',
  '        if (current.length === next.length && current.every((wire, index) => wire.d === next[index]?.d)) {',
)

// 3) size the svg in content pixels: 1 unit = 1 px, no scaling
source = source.replace(
  J([
    '                  viewBox={`0 0 ${Math.max(1, wireSize.width)} ${Math.max(1, wireSize.height)}`}',
    '                  preserveAspectRatio="none"',
  ]),
  J([
    '                  width={Math.max(1, wireSize.width)}',
    '                  height={Math.max(1, wireSize.height)}',
  ]),
)

// 4) draw: dashed grey line + arrow, exactly like the map
source = source.replace(
  J([
    '                      <path',
    '                        d={wire.d}',
    '                        fill="none"',
    '                        stroke={wire.synced',
    "                          ? 'rgba(240, 246, 255, 0.9)'",
    "                          : 'rgba(200, 206, 216, 0.35)'}",
    '                        strokeWidth={wire.synced ? 1.6 : 1.2}',
    '                        strokeLinecap="round"',
    '                      />',
  ]),
  J([
    '                      <path',
    '                        d={wire.d}',
    '                        fill="none"',
    '                        stroke="rgba(200, 206, 216, 0.42)"',
    '                        strokeWidth={1.4}',
    '                        strokeLinecap="round"',
    '                        strokeDasharray="6 5"',
    '                      />',
    '                      <path',
    '                        d="M0 0 L-9 -4 L-9 4 Z"',
    '                        transform={`translate(${wire.ax} ${wire.ay}) rotate(${wire.angle})`}',
    '                        fill="rgba(200, 206, 216, 0.5)"',
    '                      />',
  ]),
)

if (source === before) {
  console.error('nothing changed')
  process.exit(1)
}
fs.writeFileSync(file, source, 'utf8')

// CSS: absolute, content-sized, no 100%
const cssFile = 'src/client/mind-map.module.css'
let css = fs.readFileSync(cssFile, 'utf8')
css = css.replace(
  `.drawerWires {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
  overflow: visible;
}`,
  `.drawerWires {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
  z-index: 0;
}`,
)
fs.writeFileSync(cssFile, css, 'utf8')
console.log('drawer wires: pixel-sized, map-consistent')
