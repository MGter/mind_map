import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
const EDGE=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(c=>fs.existsSync(c))
const port=9597
const child=spawn(EDGE,[`--remote-debugging-port=${port}`,`--user-data-dir=${path.join(os.tmpdir(),'geo-'+Date.now())}`,'--no-first-run','--headless=new','--window-size=1700,1050','about:blank'],{stdio:'ignore'})
let ready=false; const t0=Date.now()
while(Date.now()-t0<20000&&!ready){ try{ ready=(await fetch(`http://127.0.0.1:${port}/json/version`)).ok }catch{}; if(!ready) await new Promise(r=>setTimeout(r,200)) }
const browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const page=browser.contexts()[0].pages()[0] ?? await browser.contexts()[0].newPage()
await page.setViewportSize({width:1700,height:1050})
await page.goto('file:///'+path.resolve('demo/index.html').replace(/\\/g,'/')+'?demo=1')
await page.waitForTimeout(2500)
if (await page.evaluate(() => !document.querySelector('[class*="statusRailOpen"]'))) await page.click('[class*="statusRailTab"]')
await page.waitForTimeout(600)
const geo = await page.evaluate(() => {
  const panel = document.querySelector('[class*="statusRailPanel"]')
  const list = document.querySelector('[class*="statusRailList"]')
  const card = document.querySelector('[class*="statusRailCard"]')
  const tab = document.querySelector('[class*="statusRailTab"]')
  const board = document.querySelector('[data-mindmap-session]')
  const cs = element => element === null ? null : getComputedStyle(element)
  const r = element => { if (element === null) return null; const b = element.getBoundingClientRect(); return { left: Math.round(b.left), right: Math.round(b.right), width: Math.round(b.width), height: Math.round(b.height) } }
  return {
    panel: r(panel), panelPad: cs(panel)?.padding, panelBorder: cs(panel)?.borderRightWidth,
    list: r(list), listOverflowX: cs(list)?.overflowX, listScroll: list === null ? null : { scrollWidth: list.scrollWidth, clientWidth: list.clientWidth },
    card: r(card), cardBox: cs(card)?.boxSizing, cardPad: cs(card)?.padding, cardBorder: cs(card)?.borderWidth,
    tab: r(tab), tabPad: cs(tab)?.padding, tabRadius: cs(tab)?.borderRadius,
    board: r(board), boardOffset: board === null ? null : board.offsetWidth,
    cardOffset: card === null ? null : card.offsetWidth,
  }
})
console.log(JSON.stringify(geo, null, 1))
await browser.close(); child.kill()
