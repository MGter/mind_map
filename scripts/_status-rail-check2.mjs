/**
 * Status-rail check, second design: a column of real cards at the left edge.
 *
 *   node scripts/_status-rail-check.mjs [--shot name.png]
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
  .find(candidate => fs.existsSync(candidate))
const port = 9595
const child = spawn(EDGE, [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(os.tmpdir(), 'rail2-' + Date.now())}`,
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
  const tab = document.querySelector('[class*="statusRailTab"]')
  const slots = [...document.querySelectorAll('[class*="statusRailSlot"]')]
  const boardCard = document.querySelector('[data-mindmap-session]')
  const rows = slots.map(element => {
    const card = element.querySelector('[class*="statusRailCard"]')
    const rect = card === null ? null : card.getBoundingClientRect()
    return {
      title: (card?.querySelector('[class*="cardTitle"]')?.textContent ?? '').trim(),
      chip: (card?.querySelector('[class*="cardChip"]')?.textContent ?? '').trim(),
      width: rect === null ? 0 : Math.round(rect.width),
    }
  })
  const canvas = document.querySelector('[class*="tm_canvas"]')
  const canvasRect = canvas === null ? null : canvas.getBoundingClientRect()
  const panelRect = panel === null ? null : panel.getBoundingClientRect()
  const tabRect = tab === null ? null : tab.getBoundingClientRect()
  return {
    hasRoot: root !== null,
    open: root === null ? false : root.className.includes('statusRailOpen'),
    rows,
    boardCardWidth: boardCard === null ? 0 : Math.round(boardCard.getBoundingClientRect().width),
    panelLeft: panelRect === null ? null : Math.round(panelRect.left),
    canvasLeft: canvasRect === null ? null : Math.round(canvasRect.left),
    panelWidth: panelRect === null ? null : Math.round(panelRect.width),
    tabLeft: tabRect === null ? null : Math.round(tabRect.left),
    transition: panel === null ? '' : getComputedStyle(panel).transition,
    transform: panel === null ? '' : getComputedStyle(panel).transform,
  }
})

const url = 'file:///' + path.resolve('demo/index.html').replace(/\\/g, '/') + '?demo=1'
await page.goto(url)
await page.waitForTimeout(2600)
const closed = await read()

if (!closed.open) await page.click('[class*="statusRailTab"]')
await page.waitForTimeout(600)
const opened = await read()

const before = opened.rows.map(row => row.title)
const dragged = await page.evaluate(() => {
  const slots = [...document.querySelectorAll('[class*="statusRailSlot"]')]
  if (slots.length < 2) return 0
  const data = new DataTransfer()
  const fire = (element, type) => element.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }))
  fire(slots[1], 'dragstart')
  fire(slots[0], 'dragover')
  fire(slots[0], 'drop')
  fire(slots[1], 'dragend')
  return slots.length
})
await page.waitForTimeout(500)
const afterDrag = await read()
const storedOrder = await page.evaluate(() => window.localStorage.getItem('dsh.mind-map.status-rail.order.v1'))

await page.reload()
await page.waitForTimeout(2600)
const afterReload = await read()

const layoutWidth = await page.evaluate(() => {
  const rail = document.querySelector('[class*="statusRailCard"]')
  const board = document.querySelector('[data-mindmap-session]')
  return { rail: rail === null ? 0 : rail.offsetWidth, board: board === null ? 0 : board.offsetWidth }
})

const shot = process.argv.includes('--shot') ? process.argv[process.argv.indexOf('--shot') + 1] : 'test/shots/status-rail.png'
await page.screenshot({ path: shot })
await browser.close()
child.kill()


const allCards = opened.rows.length > 0 && layoutWidth.rail === layoutWidth.board && opened.rows.every(row => row.chip !== '')
const flushLeft = opened.panelLeft !== null && opened.canvasLeft !== null && opened.panelLeft === opened.canvasLeft
const eased = /transform/.test(opened.transition)
const tabOverlaps = opened.tabLeft !== null && opened.panelWidth !== null && opened.panelLeft !== null
  && opened.tabLeft > opened.panelLeft && opened.tabLeft < opened.panelLeft + opened.panelWidth
const dragMoved = dragged >= 2 && afterDrag.rows[0]?.title === before[1] && storedOrder !== null

console.log(JSON.stringify({
  errors,
  shutByDefault: !closed.open && (closed.rows?.length ?? 0) > 0,
  closedPanelOffscreen: closed.transform.includes('-'),
  opened: opened.open,
  rows: opened.rows.length,
  boardCardWidth: opened.boardCardWidth,
  cardWidths: opened.rows.map(row => row.width),
  cardsMatchBoard: allCards,
  railLayoutWidth: layoutWidth.rail,
  boardLayoutWidth: layoutWidth.board,
  panelLeft: opened.panelLeft,
  canvasLeft: opened.canvasLeft,
  tabLeft: opened.tabLeft,
  flushLeft,
  panelWidth: opened.panelWidth,
  transition: opened.transition,
  eased,
  tabOverlapsPanel: tabOverlaps,
  dragMoved,
  orderSurvivedReload: afterReload.open,
  sample: opened.rows.slice(0, 4),
}, null, 1))

process.exitCode = errors.length === 0 && !closed.open && opened.open && allCards
  && flushLeft && eased && tabOverlaps && dragMoved && afterReload.open ? 0 : 1
