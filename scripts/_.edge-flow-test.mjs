/** Rewrite the edge-flow expectations for the glowing solid line. */
import fs from 'node:fs'

const file = 'test/edge-flow.test.mjs'
const content = `/**
 * Static checks on the built client + stylesheet.
 *
 * Two looks, both static:
 *   未同步  = 细灰线，几乎不发光
 *   同步中  = 实线 + 外发光（模糊的宽描边垫底 + 亮线本体 + drop-shadow）
 * There is no travelling light any more, and no particles.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'

const bundle = fs.readFileSync('client/client.js', 'utf8')
const css = fs.readFileSync('src/client/mind-map.module.css', 'utf8')

// 1. every edge renders through the custom component
assert.match(bundle, /type: MIND_MAP_EDGE_TYPE/, 'edges must use the custom renderer')
assert.match(bundle, /edgeTypes=\\{?\\s*edgeTypes|edgeTypes:/, 'edgeTypes must be registered on ReactFlow')

// 2. solid line, never dashed
assert.match(bundle, /strokeWidth: synced \\? 1\\.9 : 1\\.4/, 'the line width must depend on the state')
assert.ok(!/strokeDasharray/.test(bundle), 'the map line must no longer be dashed')

// 3. the glow: a wide blurred copy underneath plus a drop-shadow on the line
assert.match(bundle, /blur\\(4px\\)/, 'the glow layer must be blurred')
assert.match(bundle, /drop-shadow/, 'the crisp line must carry a drop shadow')
assert.match(bundle, /196, 219, 255/, 'the glow must be the light blue of the ring')

// 4. direction: a hand-drawn arrowhead, oriented to the target face
assert.match(bundle, /M0 0 L-11 -5 L-11 5 Z/, 'the arrowhead must be drawn here')
assert.match(bundle, /arrowAngle/, 'the arrowhead must orient to the target face')

// 5. no travelling light and no particles
assert.ok(!/SWEEP_S/.test(bundle), 'the sweep must be gone')
assert.ok(!/SPARK/.test(bundle), 'spark particles must stay gone')
assert.ok(!/maskUnits/.test(bundle), 'the sweep mask must be gone')

// 6. routing: faces are computed, not hardcoded
assert.match(bundle, /pickFaces/, 'edges must use the routing module')
assert.match(bundle, /computedHandles/, 'stored edges must recompute their faces')

// 7. the drawer draws the same links
assert.match(bundle, /drawerWires/, 'the stack drawer must draw its links')
assert.match(bundle, /DrawerWire|links: readonly/, 'the drawer must accept the links')

// 8. no leftover looks in the stylesheet
for (const gone of ['tmEdgeHead', 'tmEdgeMid', 'tmEdgeTail', 'tmEdgeComet', 'tmEdgeBloom', 'tmEdgeFlow', 'tmEdgeSweep']) {
  assert.ok(!css.includes(gone), 'the ' + gone + ' rule must be gone from the stylesheet')
}

console.log('edge-flow: 16 checks passed')
`
fs.writeFileSync(file, content, 'utf8')
console.log('test rewritten')
