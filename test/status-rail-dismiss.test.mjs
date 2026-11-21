import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

// "我知道了" must clear a rail row WITHOUT navigating to the session.
// The real component is compiled from the TSX source; only React hooks and the
// DOM surface are shimmed, so the assertions exercise the shipped logic.
const require = createRequire(import.meta.url)
const compiler = process.env.STATUS_RAIL_ESBUILD || process.env.RAIL_TEST_ESBUILD
  || (() => { try { return require.resolve('esbuild') } catch { return new URL('../.cache/rail-tools/node_modules/esbuild/lib/main.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') } })()
const { transformSync } = require(compiler)
const source = process.env.STATUS_RAIL_SOURCE_REF
  ? execFileSync('git', ['show', `${process.env.STATUS_RAIL_SOURCE_REF}:src/client/StatusRail.tsx`], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
  })
  : fs.readFileSync(new URL('../src/client/StatusRail.tsx', import.meta.url), 'utf8')
const compiled = transformSync(source.replace(/^import .*$/gm, ''), {
  loader: 'tsx', format: 'cjs', jsxFactory: 'React.createElement', target: 'es2022',
}).code

const buildEntries = () => ['a', 'b'].map(cardId => ({
  cardId, sessionId: `session-${cardId}`, title: cardId, lamp: 'done', stamp: 10,
}))

function mountRail() {
  const hooks = []
  const acknowledged = []
  const focused = []
  const store = new Map()
  let cursor = 0
  let dirty = false
  let tree
  let pendingEffects = []
  let entries = buildEntries()
  const depsEqual = (a, b) => a !== undefined && b !== undefined && a.length === b.length && a.every((x, i) => Object.is(x, b[i]))
  const effect = (fn, deps) => {
    const i = cursor++
    const previous = hooks[i]
    if (previous && depsEqual(previous.deps, deps)) return
    hooks[i] = { deps, cleanup: previous?.cleanup }
    pendingEffects.push(() => { hooks[i].cleanup?.(); hooks[i].cleanup = fn() })
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
  const listeners = new Map()
  const target = name => {
    const own = new Map()
    listeners.set(name, own)
    return {
      addEventListener(type, fn) { if (!own.has(type)) own.set(type, new Set()); own.get(type).add(fn) },
      removeEventListener(type, fn) { own.get(type)?.delete(fn) },
    }
  }
  const window = { ...target('window'), localStorage: {
    getItem(key) { return store.get(key) ?? null },
    setItem(key, value) { store.set(key, String(value)) },
  } }
  const document = { ...target('document'), elementFromPoint() { return undefined } }
  const module = { exports: {} }
  const context = {
    module, exports: module.exports, React, ...React, window, document, console,
    styles: new Proxy({}, { get: (_t, key) => String(key) }),
    relativeTime: () => '', t: key => key,
    LAMP_CHIP: new Proxy({}, { get: () => ({ className: 'chip', key: 'done', dot: false }) }),
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
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
      tree = module.exports.StatusRail({
        entries, cardWidth: 240,
        onFocus: cardId => focused.push(cardId),
        onAcknowledge: sessionId => acknowledged.push(sessionId),
      })
      const effects = pendingEffects
      pendingEffects = []
      effects.forEach(run => run())
    } while (dirty)
  }
  render()
  return {
    rows: () => all(node => hasClass(node, 'statusRailCard')).map(node => node.props.title),
    dismissButtons: () => all(node => hasClass(node, 'tm_statusRailDismiss')),
    clickDismiss(title) {
      const card = all(node => hasClass(node, 'statusRailCard') && node.props.title === title)[0]
      assert.ok(card, `row ${title} is rendered`)
      let button
      walk(card, node => { if (hasClass(node, 'tm_statusRailDismiss')) button = node })
      assert.ok(button, `row ${title} offers 我知道了`)
      let bubbled = false
      const event = { stopPropagation() { bubbled = true }, preventDefault() {} }
      button.props.onPointerDown?.(event)
      button.props.onClick(event)
      render()
      return { bubbled }
    },
    setEntries(next) { entries = next; dirty = true; render() },
    focused, acknowledged,
  }
}

test('每个带状态的行都有"我知道了"按钮', () => {
  const rail = mountRail()
  assert.equal(rail.rows().length, 2)
  assert.equal(rail.dismissButtons().length, 2)
})

test('点"我知道了"只确认、不打开会话，并且这一行立刻消失', () => {
  const rail = mountRail()
  const { bubbled } = rail.clickDismiss('a')
  assert.equal(bubbled, true, 'the click must not bubble into the row open handler')
  assert.deepEqual(rail.acknowledged, ['session-a'])
  assert.deepEqual(rail.focused, [])
  assert.deepEqual(rail.rows(), ['b'])
})

test('同一个会话之后又有新的完成（stamp 变大）会重新出现', () => {
  const rail = mountRail()
  rail.clickDismiss('a')
  assert.deepEqual(rail.rows(), ['b'])
  rail.setEntries([
    { cardId: 'a', sessionId: 'session-a', title: 'a', lamp: 'done', stamp: 11 },
    { cardId: 'b', sessionId: 'session-b', title: 'b', lamp: 'done', stamp: 10 },
  ])
  // 刚变过的行会排到最上面（既有行为），这里只关心它重新出现。
  assert.deepEqual(rail.rows().slice().sort(), ['a', 'b'])
})
