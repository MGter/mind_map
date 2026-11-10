/**
 * Only two line kinds, visually:
 *   • 同步中 — the packet runs along it (still carrying the latest context);
 *   • 没同步 — a plain dashed line. Whatever the reason (never pushed, source moved
 *     on, or a derived lineage line), it looks the same: nothing is flowing.
 *
 * The three-way state machine stays for internal decisions (a far-behind edge still
 * counts as "not synced"), but the canvas no longer paints three different colours:
 * amber/red glow read as decoration, not as information the eye can trust.
 *
 * The menu also stops explaining itself: the "这是血缘线（自动生成）" row is gone.
 */
import fs from 'node:fs'

const EOL_OF = (text) => (text.includes('\r\n') ? '\r\n' : '\n')

// ---- 1. MapCanvas: two classes, no lineage marker, no info row --------
const file = 'src/client/MapCanvas.tsx'
let source = fs.readFileSync(file, 'utf8')
let EOL = EOL_OF(source)
let J = (lines) => lines.join(EOL)

// stored edges
source = source.replace(
  J([
    '        // Read by the stylesheet: flow while synced, amber when behind, red',
    '        // when far behind. Classes beat inline styles for keyframes.',
    '        className: `tmEdge tmEdge-${sync}`,',
  ]),
  J([
    '        // Two looks only: the packet runs while in sync, otherwise plain dashes.',
    "        className: `tmEdge ${sync === 'synced' ? 'tmEdge-synced' : 'tmEdge-idle'}`,",
  ]),
)

// lineage lines: same two looks, no separate marker
source = source.replace(
  J([
    '        // Structural marker, never conditional: a lineage line must look like a',
    '        // lineage line in every state — only its colour changes.',
    '        className: `tmEdge tmEdge-${lineageSync} tmEdge-lineage`,',
  ]),
  J([
    '        // Same two looks as any other line.',
    '        className: `tmEdge ${lineageSync === \'synced\' ? \'tmEdge-synced\' : \'tmEdge-idle\'}`,',
  ]),
)

// arrow colour: synced gold, everything else neutral
source = source.replace(
  J([
    '          color: sync === \'far\'',
    "            ? 'rgba(242, 78, 78, 0.9)'",
    "            : sync === 'stale'",
    "              ? 'rgba(255, 214, 106, 0.95)'",
    "              : kind === 'link' ? 'rgba(255, 255, 255, 0.5)' : 'rgba(255, 214, 106, 0.85)',",
  ]),
  J([
    "          color: sync === 'synced'",
    "            ? 'rgba(255, 214, 106, 0.9)'",
    "            : 'rgba(255, 255, 255, 0.45)',",
  ]),
)

// menu: drop the explanatory row
source = source.replace(
  J([
    '      const lineage = stored === undefined',
    '      // Say what this line is, whichever kind it is.',
    '      if (lineage) {',
    '        items.push({',
    "          key: 'lineage-info',",
    "          label: t('edge.lineageTitle'),",
    "          hint: t('edge.lineageHint'),",
    '          disabled: true,',
    '        })',
    '      }',
  ]),
  '      const lineage = stored === undefined',
)
fs.writeFileSync(file, source, 'utf8')
console.log('canvas: two line looks, no info row')

// ---- 2. CSS: two looks only -------------------------------------------
const cssFile = 'src/client/mind-map.module.css'
let css = fs.readFileSync(cssFile, 'utf8')
const start = css.indexOf('/* ---- edge sync: a packet runs along a line that is still in sync ------- */')
const endMarker = '@media (prefers-reduced-motion: reduce) {'
const endAt = css.indexOf(endMarker, start)
if (start < 0 || endAt < 0) {
  console.error('css block not found')
  process.exit(1)
}
// find the closing of that reduced-motion block too
let blockEnd = css.indexOf('}', css.indexOf('animation: none;', endAt))
blockEnd = css.indexOf('}', blockEnd + 1)

const replacement = [
  '/* ---- edges: two looks ------------------------------------------------',
  '   同步中 = 一道光沿路径跑；其余（从没推过 / 母对话已变 / 血缘派生）一律虚线。',
  '   三种颜色会读成装饰，只有"在流动"和"没在流动"是能一眼信的信息。 */',
  '.canvas :global(.react-flow__edge-path) {',
  '  transition: stroke 260ms ease-out;',
  '}',
  '',
  '.canvas :global(.tmEdge path.react-flow__edge-path) {',
  '  stroke: rgba(255, 255, 255, 0.32);',
  '  stroke-width: 1.6;',
  '  stroke-linecap: round;',
  '  stroke-dasharray: 6 4;',
  '}',
  '',
  '/* 同步中：暖金 + 光流 */',
  '.canvas :global(.tmEdge-synced path.react-flow__edge-path) {',
  '  stroke: rgba(255, 214, 106, 0.75);',
  '  stroke-dasharray: 5 9;',
  '  animation: tmFlow 1.05s linear infinite;',
  '}',
  '',
  '@keyframes tmFlow {',
  '  from { stroke-dashoffset: 28; }',
  '  to { stroke-dashoffset: 0; }',
  '}',
  '',
  '@media (prefers-reduced-motion: reduce) {',
  '  .canvas :global(.tmEdge-synced path.react-flow__edge-path) {',
  '    animation: none;',
  '    stroke-dasharray: 6 4;',
  '  }',
  '}',
  '',
].join(EOL_OF(css))

css = css.slice(0, start) + replacement + css.slice(blockEnd + 1)
fs.writeFileSync(cssFile, css, 'utf8')
console.log('css: two looks only')
