/**
 * Expectations for the final look: gray dashed line; synced = opacity 0.
 */
import fs from 'node:fs'

const file = 'test/edge-flow.test.mjs'
const content = `/**
 * Static checks on the built client + stylesheet.
 *
 * 未同步 = 灰色虚线；同步中 = 整条线透明度 0（看不见）。
 * 没有发光、没有流光、没有粒子。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'

const bundle = fs.readFileSync('client/client.js', 'utf8')
const css = fs.readFileSync('src/client/mind-map.module.css', 'utf8')

// 1. every edge renders through the custom component
assert.match(bundle, /type: MIND_MAP_EDGE_TYPE/, 'edges must use the custom renderer')
assert.match(bundle, /edgeTypes=\\{?\\s*edgeTypes|edgeTypes:/, 'edgeTypes must be registered on ReactFlow')

// 2. a dashed grey line, hidden entirely once synced
assert.match(bundle, /strokeDasharray: "6 5"/, 'the line must be dashed')
assert.match(bundle, /opacity: synced \\? 0 : 1/, 'a synced line must be invisible')

// 3. no glow of any kind
assert.ok(!/drop-shadow/.test(bundle), 'no drop shadow any more')
assert.ok(!/blur\\(4px\\)/.test(bundle), 'no blurred glow layer any more')
assert.ok(!/196, 219, 255/.test(bundle), 'no glow colour any more')

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

// 7. the drawer draws the same links — and skips the synced ones
assert.match(bundle, /drawerWires/, 'the stack drawer must draw its links')
assert.match(bundle, /links: drawerWireLinks/, 'the canvas must feed the drawer its links')
assert.match(bundle, /filter\\(\\(?link\\)? => !link\\.synced\\)|filter\\(link => !link\\.synced\\)/, 'synced pairs must not draw in the drawer')

// 8. no leftover looks in the stylesheet
for (const gone of ['tmEdgeHead', 'tmEdgeMid', 'tmEdgeTail', 'tmEdgeComet', 'tmEdgeBloom', 'tmEdgeFlow', 'tmEdgeSweep']) {
  assert.ok(!css.includes(gone), 'the ' + gone + ' rule must be gone from the stylesheet')
}

console.log('edge-flow: 16 checks passed')
`
fs.writeFileSync(file, content, 'utf8')
console.log('rewritten')
