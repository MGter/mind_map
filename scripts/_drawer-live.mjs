/**
 * The real StackDrawer, rendered in a real browser with links, measured the way the user
 * looks at it: does any wire leave the panel, and does each wire end on the card it claims?
 *
 *   node scripts/_drawer-live.mjs [--shot name.png]
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const entry = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { StackDrawer } from '../../src/client/StackDrawer.tsx'

const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
const items = ids.map((id, index) => ({
  cardId: 'card-' + id,
  sessionId: 'sess-' + id,
  title: '卡片 ' + id.toUpperCase(),
  preview: '这里是一段正文，用来把卡片撑到正常高度。',
  updatedAt: Date.now() - index * 3600_000,
}))
// Top-row cards wired through their top faces (the reported case), plus a long link.
const links = [
  { from: 'card-a', to: 'card-e', visible: true },
  { from: 'card-a', to: 'card-f', visible: true },
  { from: 'card-a', to: 'card-g', visible: true },
  { from: 'card-b', to: 'card-h', visible: true },
  { from: 'card-d', to: 'card-e', visible: true },
  { from: 'card-a', to: 'card-h', visible: true },
  { from: 'card-c', to: 'card-d', visible: true },
]

createRoot(document.getElementById('root')).render(
  React.createElement(StackDrawer, {
    groupId: 'g',
    workspaceTitle: '抽屉',
    items,
    links,
    onOpenCard: () => {},
    onClose: () => {},
  }),
)
`

fs.mkdirSync('test/shots', { recursive: true })
fs.writeFileSync('test/shots/drawer-live-entry.tsx', entry, 'utf8')

const cssStub = {
  name: 'css-modules-stub',
  setup(build) {
    build.onResolve({ filter: /\.css$/ }, args => ({ path: args.path, namespace: 'cssstub' }))
    build.onLoad({ filter: /.*/, namespace: 'cssstub' }, () => ({
      contents: 'export default new Proxy({}, { get: (_target, key) => "tm_" + String(key) })',
      loader: 'js',
    }))
  },
}

await build({
  entryPoints: ['test/shots/drawer-live-entry.tsx'],
  bundle: true,
  outfile: 'test/shots/drawer-live.js',
  format: 'iife',
  jsx: 'automatic',
  loader: { '.tsx': 'tsx', '.ts': 'ts' },
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [cssStub],
  logLevel: 'error',
})
// The plugin's own stylesheet, scoped exactly the way the build scopes it (tm_ prefix),
// so the harness lays the drawer out like the app instead of guessing.
const rawCss = fs.readFileSync('src/client/mind-map.module.css', 'utf8')
const scopedCss = rawCss
  .replace(/:global\(([^()]*)\)/g, '$1')
  .replace(/\.([a-zA-Z][\w-]*)/g, '.tm_$1')
  .replace(/@keyframes\s+([a-zA-Z][\w-]*)/g, '@keyframes tm_$1')
  .replace(/animation:\s*([a-zA-Z][\w-]*)/g, 'animation: tm_$1')
fs.writeFileSync('test/shots/drawer-live.html', `<!doctype html><meta charset="utf-8">
<style>
  html, body { margin: 0; background: #0d0f13; color: #cfd6e3; font: 13px/1.5 system-ui, sans-serif; }
  #root { padding: 24px; }
${scopedCss}
</style>
<div id="root"></div><script src="./drawer-live.js"></script>`, 'utf8')

const EDGE_BIN = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
  .find(candidate => fs.existsSync(candidate))
const port = 9521
const child = spawn(EDGE_BIN, [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(os.tmpdir(), 'dl-' + Date.now())}`,
  '--no-first-run', '--disable-extensions', '--window-size=1400,900', '--headless=new', 'about:blank'], { stdio: 'ignore' })

let ready = false
const started = Date.now()
while (Date.now() - started < 20000 && !ready) {
  try { ready = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok } catch { /* not up */ }
  if (!ready) await new Promise(resolve => setTimeout(resolve, 200))
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const page = browser.contexts()[0].pages()[0] ?? await browser.contexts()[0].newPage()
await page.setViewportSize({ width: 1400, height: 900 })
const errors = []
page.on('pageerror', error => errors.push(String(error).slice(0, 160)))
await page.goto('file:///' + path.resolve('test/shots/drawer-live.html').replace(/\\/g, '/'))
await page.waitForTimeout(1500)

const report = await page.evaluate(() => {
  const scroller = document.querySelector('[class*="drawerScroll"]')
  if (scroller === null) return { error: 'no drawer', body: document.body.innerHTML.slice(0, 200) }
  const base = scroller.getBoundingClientRect()
  const cards = [...scroller.querySelectorAll('[data-card-id]')].map(element => {
    const rect = element.getBoundingClientRect()
    return { id: element.getAttribute('data-card-id'),
      x: rect.left - base.left, y: rect.top - base.top, w: rect.width, h: rect.height }
  })
  const paths = [...scroller.querySelectorAll('svg path')].filter(element => !(element.getAttribute('d') ?? '').startsWith('M0 0'))
  const wires = paths.map(element => {
    const total = element.getTotalLength()
    const points = []
    for (let distance = 0; distance <= total; distance += 2) points.push(element.getPointAtLength(distance))
    let outside = 0
    let cross = 0
    for (const point of points) {
      if (point.x < -1 || point.y < -1 || point.x > scroller.clientWidth + 1 || point.y > scroller.scrollHeight + 1) outside += 1
      for (const card of cards) {
        if (point.x > card.x + 1 && point.x < card.x + card.w - 1 && point.y > card.y + 1 && point.y < card.y + card.h - 1) cross += 1
      }
    }
    const gap = point => Math.min(...cards.map(card => Math.hypot(
      Math.max(card.x - point.x, 0, point.x - (card.x + card.w)),
      Math.max(card.y - point.y, 0, point.y - (card.y + card.h)),
    )))
    return { d: element.getAttribute('d') ?? '', outside, cross,
      from: element.getAttribute('data-from') ?? null, to: element.getAttribute('data-to') ?? null,
      head: [Math.round(points[0].x), Math.round(points[0].y)], tail: [Math.round(points[points.length-1].x), Math.round(points[points.length-1].y)],
      headGap: Math.round(gap(points[0]) * 10) / 10, tailGap: Math.round(gap(points[points.length - 1]) * 10) / 10 }
  })
  return { cards: cards.length, boxes: cards.map(c => ({ id: c.id, x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.w), h: Math.round(c.h) })), wires }
})

const shot = process.argv.includes('--shot') ? process.argv[process.argv.indexOf('--shot') + 1] : 'test/shots/drawer-live.png'
await page.screenshot({ path: shot })
await browser.close()
child.kill()

console.log(JSON.stringify({ errors, report }, null, 1))
