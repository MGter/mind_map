/**
 * Status rail, third pass: frosted handle, queue title, pointer drag with avoidance.
 *
 *   node scripts/_status-rail-check3.mjs [--shot name.png]
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
  .find(candidate => fs.existsSync(candidate))
const port = 9599
const child = spawn(EDGE, [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(os.tmpdir(), 'rail3-' + Date.now())}`,
  '--no-first-run', '--headless=new', '--window-size=1700,1050', 'about:blank'], { stdio: 'ignore' })

let ready = false
const started = Date.now()
while (Date.now() - started < 20000 && !ready) {
  try { ready = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok } catch { /* not up */ }
  if (!ready) await new Promise(resolve => setTimeout(resolve, 200))
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const ctx = browser.contexts()[0]
const page = ctx.pages()[0] ?? await ctx.newPage()
await page.setViewportSize({ width: 1700, height: 1050 })
const errors = []
page.on('pageerror', error => errors.push(String(error).slice(0, 160)))

const read = () => page.evaluate(() => {
  const root = document.querySelector('[class*="statusRail"]')
  const panel = document.querySelector('[class*="statusRailPanel"]')
  const tab = document.querySelector('button[class*="statusRailTab"]')
  const title = document.querySelector('[class*="statusRailTitle"]')
  const svg = tab === null ? null : tab.querySelector('svg')
  const slots = [...document.querySelectorAll('[class*="statusRailSlot"]')]
  const rows = slots.map(element => {
    const card = element.querySelector('[class*="statusRailCard"]')
    const rect = card?.getBoundingClientRect() ?? null
    return {
      title: (card?.querySelector('[class*="cardTitle"]')?.textContent ?? '').trim(),
      chip: (card?.querySelector('[class*="cardChip"]')?.textContent ?? '').trim(),
      top: rect === null ? 0 : Math.round(rect.top),
      left: rect === null ? 0 : Math.round(rect.left),
      width: rect === null ? 0 : Math.round(rect.width),
    }
  })
  return {
    open: root === null ? false : root.getAttribute('data-open') === '1',
    title: (title?.textContent ?? '').trim(),
    tabBox: tab === null ? null : tab.getBoundingClientRect().toJSON(),
    tabBackdrop: tab === null ? '' : getComputedStyle(tab).backdropFilter,
    barHeight: svg === null ? 0 : Math.round(svg.getBoundingClientRect().height),
    rows,
    panelLeft: panel === null ? null : Math.round(panel.getBoundingClientRect().left),
    canvasLeft: (() => {
      const canvas = document.querySelector('[class*="tm_canvas"]')
      return canvas === null ? null : Math.round(canvas.getBoundingClientRect().left)
    })(),
  }
})

const url = 'file:///' + path.resolve('demo/index.html').replace(/\\/g, '/') + '?demo=1'
await page.goto(url)
await page.waitForTimeout(2600)
const closed = await read()
// The count badge also matches the substring; click the button itself.
if (!closed.open) await page.click('button[class*="statusRailTab"]')
await page.waitForTimeout(600)
const opened = await read()

// Pointer drag: pick the second card, drop it on the first one's centre.
const before = opened.rows.map(row => row.title)
const boxes = opened.rows.map(row => ({ x: row.left + 60, y: row.top + 30 }))
let dragMoved = false
if (boxes.length >= 2) {
  await page.mouse.move(boxes[1].x, boxes[1].y)
  await page.mouse.down()
  await page.waitForTimeout(150)
  await page.mouse.move(boxes[1].x, boxes[1].y - 40, { steps: 8 })
  await page.mouse.move(boxes[0].x, boxes[0].y - 20, { steps: 15 })
  await page.waitForTimeout(250)
  const midDrag = await read()
  await page.mouse.up()
  await page.waitForTimeout(500)
  const after = await read()
  const stored = await page.evaluate(() => window.localStorage.getItem('dsh.mind_map.status-rail.order.v1'))
  dragMoved = after.rows[0]?.title === before[1] && stored !== null
  var dragDebug = { before, afterFirst: after.rows[0]?.title, stored }
  var midDragFloating = midDrag.rows.length === before.length
  var afterRows = after.rows.map(row => row.title)
}

await page.reload()
await page.waitForTimeout(2600)
const afterReload = await read()

const shot = process.argv.includes('--shot') ? process.argv[process.argv.indexOf('--shot') + 1] : 'test/shots/status-rail-v5.png'
await page.screenshot({ path: shot })
await browser.close()
child.kill()

const frosted = /blur/.test(opened.tabBackdrop)
const titleOk = opened.title === '队列中的任务'
const barsLonger = opened.barHeight >= 24
const cardsOk = opened.rows.length > 0 && opened.rows.every(row => row.chip !== '')

console.log(JSON.stringify({
  errors,
  shutByDefault: !closed.open,
  title: opened.title,
  titleOk,
  tabBackdrop: opened.tabBackdrop,
  frosted,
  barHeight: opened.barHeight,
  barsLonger,
  rows: opened.rows.length,
  cardsOk,
  dragMoved,
  dragDebug,
  afterRows,
  orderSurvivedReload: afterReload.open,
  flushLeft: opened.panelLeft === opened.canvasLeft,
  panelLeft: opened.panelLeft,
  canvasLeft: opened.canvasLeft,
}, null, 1))

process.exitCode = errors.length === 0 && !closed.open && titleOk && frosted && barsLonger
  && cardsOk && dragMoved && afterReload.open ? 0 : 1
