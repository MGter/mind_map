import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the actual surface without a browser, store writes, or disk output.
// Instrumentation exists only in this in-memory copy of the function.
const source = fs.readFileSync(new URL('../src/graph/graph-surface.js', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace('  return (0, import_jsx_runtime16.jsxs)("div", {',
    '  globalThis.probe = { ensureSim, reheat, tickSim, commitSim, simRef, cameraRef, drawRef, hoverRef };\n  return (0, import_jsx_runtime16.jsxs)("div", {');

function mount(nodes, edges = [], savedSignature = '') {
  const effects = [];
  const frames = [];
  const changes = [];
  const commits = [];
  const storage = new Map([['sig', savedSignature]]);
  const window = {
    devicePixelRatio: 1,
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    requestAnimationFrame: fn => { frames.push(fn); return frames.length; },
    cancelAnimationFrame() {},
  };
  const sandbox = {
    console, window, performance: { now: () => 1000 },
    readGraphCamera: () => ({ x: 0, y: 0, zoom: 1 }), writeGraphCamera() {},
    import_react13: { useRef: current => ({ current }), useEffect: fn => effects.push(fn) },
    import_jsx_runtime16: {
      jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }),
    },
    mindMapTapBridge: { live: { commit: points => commits.push(points) } },
    mindMapPendingFit: { until: 0 }, mindMapCameraTouched: true, mindMapAutoFitAt: Date.now(),
    mindMapLive: { subscribe: () => () => {} },
    mindMapFitKick: {}, mindMapSimKick: {}, mindMapCanvasToFlow: {}, mindMapCenterKick: {},
    mindMapDrawCount: 0, MIND_MAP_LAID_SIG_KEY: 'sig', GRAPH_FONT_STACK: 'sans',
    graphEllipsis: (_context, text) => text, graphRoundRect() {},
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  const element = sandbox.GraphCanvasSurface({ nodes, edges, onNodesChange: items => changes.push(...items) });
  element.props.ref.current = {
    clientWidth: 800, clientHeight: 600, isConnected: true,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture() {}, addEventListener() {}, removeEventListener() {},
  };
  effects.forEach(effect => effect());
  return { sandbox, probe: sandbox.probe, element, frames, changes, commits };
}

const session = (id, x, y, data = {}) => ({ id, type: 'sessionDot', position: { x, y }, data });
const pointer = (clientX, clientY) => ({
  button: 0, clientX, clientY, pointerId: 1, target: null, preventDefault() {},
});

function activeDrag() {
  const runtime = mount([session('a', 0, 0), session('b', 1000, 0)]);
  const state = runtime.probe.simRef.current.nodes.get('a');
  state.x = 300;
  state.y = 200;
  runtime.probe.cameraRef.current = { x: 0, y: 0, zoom: 1 };
  runtime.element.props.onPointerDown(pointer(300, 200));
  runtime.element.props.onPointerMove(pointer(320, 200));
  return runtime;
}

test('matching saved signature preserves stored coordinates on remount', () => {
  const runtime = mount([session('a', 0, 0), session('b', 1000, 0)], [], 'cloud-v1:a,b');
  const positions = runtime.sandbox.window.__mindMapDebug.nodes();
  assert.equal(positions.a.x, 0);
  assert.equal(positions.a.y, 0);
  assert.equal(positions.b.x, 1000);
  assert.equal(positions.b.y, 0);
});

test('dragging starts from the visible simulation coordinates', () => {
  const runtime = activeDrag();
  const box = runtime.sandbox.window.__mindMapDebug.box('a');
  assert.equal(box.cx, 320);
  assert.equal(box.cy, 200);
});

test('first pointer movement emits only finite positions', () => {
  const runtime = activeDrag();
  assert.ok(runtime.changes.length >= 1);
  for (const change of runtime.changes) {
    assert.ok(Number.isFinite(change.position?.x), 'position.x must be finite');
    assert.ok(Number.isFinite(change.position?.y), 'position.y must be finite');
  }
});

test('idle simulation keeps settled keyword coordinates', () => {
  const tag = { id: 'tag-x', type: 'tagNode', position: { x: 20, y: 0 }, data: { tagNode: true } };
  const runtime = mount([session('a', 0, 0), session('b', 40, 0), tag], [
    { source: 'a', target: 'tag-x' }, { source: 'b', target: 'tag-x' },
  ]);
  const sim = runtime.probe.simRef.current;
  sim.nodes.get('tag-x').x = 70;
  sim.nodes.get('tag-x').y = 80;
  sim.alpha = 0;
  runtime.probe.ensureSim();
  assert.equal(sim.nodes.get('tag-x').x, 70);
  assert.equal(sim.nodes.get('tag-x').y, 80);
});

test('hover does not stop redraws for a running session', () => {
  const runtime = mount([session('running', 0, 0, { running: true })], [], 'cloud-v1:running');
  runtime.probe.simRef.current.alpha = 0;
  runtime.sandbox.mindMapCameraTouched = true;
  runtime.probe.hoverRef.current = 'running';
  let draws = 0;
  runtime.probe.drawRef.current = () => { draws += 1; };
  const animate = runtime.frames.find(fn => fn.name === 'animate');
  assert.equal(typeof animate, 'function');
  for (let frame = 0; frame < 8; frame += 1) animate();
  assert.ok(draws >= 4, `running pulse needs redraws while hovered; got ${draws}`);
});
