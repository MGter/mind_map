import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

// This unpacked plugin may borrow the compiler used by the patch/build script.
// STATUS_RAIL_ESBUILD can name an absolute esbuild package directory.
const require = createRequire(import.meta.url)
const compiler = process.env.STATUS_RAIL_ESBUILD || process.env.RAIL_TEST_ESBUILD
  || (() => { try { return require.resolve('esbuild') } catch { return new URL('../.cache/rail-tools/node_modules/esbuild/lib/main.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') } })()
const { transformSync } = require(compiler)

// Exercise the real component's pointer handlers, not element.click(). The small
// hook/DOM shim makes ref updates and effect installation explicit; it does not
// emulate browser hit-testing (the native-click browser check covers that).
// Run the same cases against a Git revision without changing the working tree.
const source = process.env.STATUS_RAIL_SOURCE_REF
  ? execFileSync('git', ['show', `${process.env.STATUS_RAIL_SOURCE_REF}:src/client/StatusRail.tsx`], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
  })
  : fs.readFileSync(new URL('../src/client/StatusRail.tsx', import.meta.url), 'utf8')
const compiled = transformSync(source.replace(/^import .*$/gm, ''), {
  loader: 'tsx', format: 'cjs', jsxFactory: 'React.createElement', target: 'es2022',
}).code
const entries = ['a', 'b', 'c'].map(cardId => ({
  cardId, sessionId: `session-${cardId}`, title: cardId, lamp: 'done', stamp: 1,
}))

function mountRail() {
  const hooks = []
  const focus = []
  const writes = []
  const store = new Map()
  const targets = new Map()
  const listeners = new Map()
  let cursor = 0
  let dirty = false
  let tree
  let pendingEffects = []
  let nextFrame = 0
  const depsEqual = (a, b) => a !== undefined && b !== undefined && a.length === b.length && a.every((x, i) => Object.is(x, b[i]))
  const effect = (fn, deps) => {
    const i = cursor++
    const previous = hooks[i]
    if (previous && depsEqual(previous.deps, deps)) return
    hooks[i] = { deps, cleanup: previous?.cleanup }
    pendingEffects.push(() => {
      hooks[i].cleanup?.()
      hooks[i].cleanup = fn()
    })
  }
  const React = {
    createElement(type, props, ...children) { return { type, props: { ...props, children } } },
    useState(initial) {
      const i = cursor++
      if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial
      return [hooks[i], value => {
        const next = typeof value === 'function' ? value(hooks[i]) : value
        if (!Object.is(next, hooks[i])) { hooks[i] = next; dirty = true }
      }]
    },
    useRef(initial) { const i = cursor++; return hooks[i] ??= { current: initial } },
    useMemo(fn, deps) {
      const i = cursor++
      if (!hooks[i] || !depsEqual(hooks[i].deps, deps)) hooks[i] = { deps, value: fn() }
      return hooks[i].value
    },
    useCallback(fn, deps) { return React.useMemo(() => fn, deps) },
    useEffect: effect,
    useLayoutEffect: effect,
    useSyncExternalStore(_subscribe, getSnapshot) { cursor++; return getSnapshot() },
  }
  function eventTarget(name) {
    const own = new Map()
    listeners.set(name, own)
    return {
      addEventListener(type, fn) { if (!own.has(type)) own.set(type, new Set()); own.get(type).add(fn) },
      removeEventListener(type, fn) { own.get(type)?.delete(fn) },
    }
  }
  const window = { ...eventTarget('window'), localStorage: {
    getItem(key) { return store.get(key) ?? null },
    setItem(key, value) { store.set(key, String(value)); writes.push([key, String(value)]) },
  } }
  const document = { ...eventTarget('document'), elementFromPoint() { return targets.get('a') } }
  const styles = new Proxy({}, { get: (_target, key) => String(key) })
  const module = { exports: {} }
  const context = {
    module, exports: module.exports, React, ...React, window, document, console,
    styles, relativeTime: () => '', t: key => key,
    LAMP_CHIP: new Proxy({}, { get: () => ({ className: 'chip', key: 'done', dot: false }) }),
    requestAnimationFrame: () => ++nextFrame, cancelAnimationFrame() {},
  }
  vm.runInNewContext(compiled, context, { filename: 'StatusRail.compiled.js' })
  const walk = (node, fn) => {
    if (Array.isArray(node)) { node.forEach(child => walk(child, fn)); return }
    if (!node || typeof node !== 'object') return
    fn(node)
    walk(node.props?.children, fn)
  }
  const all = predicate => { const found = []; walk(tree, node => { if (predicate(node)) found.push(node) }); return found }
  const hasClass = (node, name) => String(node.props?.className ?? '').split(' ').includes(name)
  function render() {
    let rounds = 0
    do {
      if (++rounds > 20) throw new Error('hook shim render did not settle')
      dirty = false
      cursor = 0
      tree = module.exports.StatusRail({ entries, cardWidth: 240, onFocus: cardId => focus.push(cardId) })
      const slots = all(node => hasClass(node, 'statusRailSlot'))
      slots.forEach((slot, index) => {
        let card
        walk(slot, node => { if (hasClass(node, 'statusRailCard')) card = node })
        const id = card.props.title
        let element = targets.get(id)
        if (!element) {
          element = {
            contains(target) { return target === this || target?.cardId === id },
            setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture() { return false },
          }
          targets.set(id, element)
        }
        const top = 40 + index * 100
        element.getBoundingClientRect = () => ({ x: 20, y: top, left: 20, right: 260, top, bottom: top + 90, width: 240, height: 90 })
        element.cardId = id
        element.closest = () => element
        slot.props.ref?.(element)
      })
      const effects = pendingEffects
      pendingEffects = []
      effects.forEach(run => run())
    } while (dirty)
  }
  render()
  writes.length = 0
  function pointer(type, { pointerId = 11, clientX = 80, clientY = 80, button = 0 } = {}, flush = true) {
    const event = {
      type, pointerId, clientX, clientY, button, buttons: type === 'pointerup' ? 0 : 1,
      isPrimary: true, target: targets.get('a'), currentTarget: targets.get('a'),
      preventDefault() {}, stopPropagation() {},
    }
    if (type === 'pointerdown') {
      const card = all(node => hasClass(node, 'statusRailCard') && node.props.title === 'a' && typeof node.props.onPointerDown === 'function')[0]
      assert.ok(card, 'the real component exposes a pointerdown handler')
      card.props.onPointerDown(event)
    } else {
      // Model a bubbling DOM event reaching document and then window once.
      for (const name of ['document', 'window']) {
        for (const listener of [...(listeners.get(name).get(type) ?? [])]) listener(event)
      }
    }
    if (flush) render()
  }
  return {
    pointer, focus,
    order: () => all(node => hasClass(node, 'statusRailSlot')).map(slot => {
      let title
      walk(slot, node => { if (hasClass(node, 'statusRailCard')) title = node.props.title })
      return title
    }),
    floating: () => all(node => hasClass(node, 'statusRailFloating')).length,
    orderWrites: () => writes.filter(([, value]) => value.startsWith('[')),
    unmount() { for (const hook of hooks) hook?.cleanup?.() },
  }
}

function scenario(name, run) {
  test(name, () => { const rail = mountRail(); try { run(rail) } finally { rail.unmount() } })
}

scenario('pointerdown keeps the original card visible until movement reaches the threshold', rail => {
  rail.pointer('pointerdown')
  assert.equal(rail.floating(), 0)
})

scenario('pointerup activates exactly once without requiring a native click', rail => {
  rail.pointer('pointerdown')
  rail.pointer('pointerup')
  rail.pointer('pointerup')
  assert.deepEqual(rail.focus, ['a'])
})

scenario('movement below 6px remains a click', rail => {
  rail.pointer('pointerdown')
  rail.pointer('pointermove', { clientX: 83, clientY: 83 })
  assert.equal(rail.floating(), 0)
  rail.pointer('pointerup', { clientX: 83, clientY: 83 })
  assert.deepEqual(rail.focus, ['a'])
})

scenario('moving beyond 6px and returning to the origin never opens', rail => {
  rail.pointer('pointerdown')
  rail.pointer('pointermove', { clientY: 100 })
  assert.equal(rail.floating(), 1)
  rail.pointer('pointermove', { clientY: 80 })
  rail.pointer('pointerup')
  assert.deepEqual(rail.focus, [])
  assert.deepEqual(rail.order(), ['a', 'b', 'c'])
})

scenario('dragging to a different row commits and persists the order without opening', rail => {
  rail.pointer('pointerdown')
  rail.pointer('pointermove', { clientY: 285 })
  rail.pointer('pointerup', { clientY: 285 })
  assert.deepEqual(rail.order(), ['b', 'c', 'a'])
  assert.equal(rail.orderWrites().length, 1)
  assert.deepEqual(JSON.parse(rail.orderWrites()[0][1]), ['b', 'c', 'a'])
  assert.deepEqual(rail.focus, [])
})

scenario('pointercancel after dragging neither commits order nor opens', rail => {
  rail.pointer('pointerdown')
  rail.pointer('pointermove', { clientY: 285 })
  rail.pointer('pointercancel', { clientY: 285 })
  rail.pointer('pointerup', { clientY: 285 })
  assert.deepEqual(rail.order(), ['a', 'b', 'c'])
  assert.equal(rail.orderWrites().length, 0)
  assert.deepEqual(rail.focus, [])
  assert.equal(rail.floating(), 0)
})

scenario('pointercancel before dragging never opens', rail => {
  rail.pointer('pointerdown')
  rail.pointer('pointercancel')
  rail.pointer('pointerup')
  assert.deepEqual(rail.focus, [])
  assert.equal(rail.orderWrites().length, 0)
})

scenario('events from another pointer cannot move or end the pending click', rail => {
  rail.pointer('pointerdown')
  rail.pointer('pointermove', { pointerId: 22, clientY: 285 })
  rail.pointer('pointerup', { pointerId: 22, clientY: 285 })
  rail.pointer('pointercancel', { pointerId: 22 })
  assert.equal(rail.floating(), 0)
  assert.deepEqual(rail.focus, [])
  rail.pointer('pointerup')
  assert.deepEqual(rail.focus, ['a'])
  assert.deepEqual(rail.order(), ['a', 'b', 'c'])
})

scenario('exactly 6px activates dragging and never opens', rail => {
  rail.pointer('pointerdown')
  rail.pointer('pointermove', { clientX: 86 })
  assert.equal(rail.floating(), 1)
  rail.pointer('pointerup', { clientX: 86 })
  assert.deepEqual(rail.focus, [])
})

scenario('fast down/move/up before another render still commits the drag', rail => {
  rail.pointer('pointerdown', {}, false)
  rail.pointer('pointermove', { clientY: 285 }, false)
  rail.pointer('pointerup', { clientY: 285 })
  assert.deepEqual(rail.order(), ['b', 'c', 'a'])
  assert.deepEqual(rail.focus, [])
})

scenario('release beyond the threshold without a move event never opens', rail => {
  rail.pointer('pointerdown')
  rail.pointer('pointerup', { clientY: 285 })
  assert.deepEqual(rail.focus, [])
})

scenario('another pointer cannot commit or cancel an active drag', rail => {
  rail.pointer('pointerdown')
  rail.pointer('pointermove', { clientY: 285 })
  rail.pointer('pointerup', { pointerId: 22, clientY: 285 })
  rail.pointer('pointercancel', { pointerId: 22, clientY: 285 })
  assert.equal(rail.floating(), 1)
  assert.deepEqual(rail.order(), ['a', 'b', 'c'])
  rail.pointer('pointerup', { clientY: 285 })
  assert.deepEqual(rail.order(), ['b', 'c', 'a'])
  assert.deepEqual(rail.focus, [])
})
