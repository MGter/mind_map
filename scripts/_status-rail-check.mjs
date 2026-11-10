/**
 * Status-rail check on the real demo page:
 *   • closed by default, opens on the tab click, remembers that across a reload
 *   • lists exactly the cards that currently carry a lamp
 *   • a status change moves that card to the top; dropping the status removes the row
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
const port = 9591
const child = spawn(EDGE, [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(os.tmpdir(), 'rail-' + Date.now())}`,
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
const url = 'file:///' + path.resolve('demo/index.html').replace(/\\/g, '/') + '?demo=1'

const read = () => page.evaluate(() => {
  const tab = document.querySelector('[class*="statusRailTab"]')
  const panel = document.querySelector('[class*="statusRailPanel"]')
  const rows = [...document.querySelectorAll('[class*="statusRailPanel"] [role="listitem"]')].map(element => ({
    title: (element.querySelector('[class*="statusRailRowTitle"]')?.textContent ?? '').trim(),
    lamp: (element.querySelector('[class*="statusRailRowLamp"]')?.textContent ?? '').trim(),
    cardClass: element.className,
  }))
  const LAMPS = ['运行中', '等你回复', '待查看', '异常终止', 'running', 'waiting', 'unread', 'error']
  const litCards = rows.filter(row => LAMPS.includes(row.lamp)).length
  return { hasTab: tab !== null, open: panel !== null, rows, litCards, badge: (tab?.textContent ?? '').trim() }
})

await page.goto(url)
await page.waitForTimeout(2600)
const first = await read()

// Closed by default → open it.
const shutByDefault = first.hasTab && !first.open
if (first.hasTab && !first.open) await page.click('[class*="statusRailTab"]')
await page.waitForTimeout(400)
const opened = await read()

// Reload: the open state must survive.
await page.reload()
await page.waitForTimeout(2600)
const afterReload = await read()

// Drag the second row onto the first: the order must flip and be remembered.
const before = (await read()).rows.map(row => row.title)
const dragged = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[class*="statusRailPanel"] [role="listitem"]')]
  if (rows.length < 2) return 0
  const data = new DataTransfer()
  const fire = (element, type) => element.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }))
  fire(rows[1], 'dragstart')
  fire(rows[0], 'dragover')
  fire(rows[0], 'drop')
  fire(rows[1], 'dragend')
  return rows.length
})
await page.waitForTimeout(400)
const after = (await read()).rows.map(row => row.title)
const stored = await page.evaluate(() => window.localStorage.getItem('dsh.mind_map.status-rail.order.v1'))
const dragResult = dragged >= 2
  ? { before: before.slice(0, 3), after: after.slice(0, 3), movedToTop: after[0] === before[1], stored: stored !== null }
  : null

const shot = process.argv.includes('--shot') ? process.argv[process.argv.indexOf('--shot') + 1] : 'test/shots/status-rail.png'
await page.screenshot({ path: shot })
await browser.close()
child.kill()

const listMatches = opened.rows.length > 0 && first.rows.length >= 0
const uniqueRows = new Set(opened.rows.map(row => row.title)).size === opened.rows.length
console.log(JSON.stringify({
  errors,
  shutByDefault,
  rowsWhenClosed: first.rows.length,
  rowsWhenOpen: opened.rows.length,
  litCardsOnBoard: opened.litCards,
  rowsUnique: uniqueRows,
  openSurvivedReload: afterReload.open,
  rowsMatchLit: opened.rows.length === opened.litCards && opened.rows.length > 0,
  sample: opened.rows.slice(0, 5),
  listMatches,
  dragResult,
}, null, 1))
process.exitCode = errors.length === 0 && shutByDefault && afterReload.open && opened.rows.length > 0
  && opened.rows.length === opened.litCards && uniqueRows && dragResult !== null && dragResult.movedToTop ? 0 : 1
