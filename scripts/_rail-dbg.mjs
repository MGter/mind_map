import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
const EDGE=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(c=>fs.existsSync(c))
const port=9601
const child=spawn(EDGE,[`--remote-debugging-port=${port}`,`--user-data-dir=${path.join(os.tmpdir(),'dbg-'+Date.now())}`,'--no-first-run','--headless=new','--window-size=1700,1050','about:blank'],{stdio:'ignore'})
let ready=false; const t0=Date.now()
while(Date.now()-t0<20000&&!ready){ try{ ready=(await fetch(`http://127.0.0.1:${port}/json/version`)).ok }catch{}; if(!ready) await new Promise(r=>setTimeout(r,200)) }
const browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const page=browser.contexts()[0].pages()[0] ?? await browser.contexts()[0].newPage()
await page.setViewportSize({width:1700,height:1050})
await page.goto('file:///'+path.resolve('demo/index.html').replace(/\\/g,'/')+'?demo=1')
await page.waitForTimeout(2600)
const state = () => page.evaluate(() => {
  const root = document.querySelector('[class*="statusRail"]')
  const panel = document.querySelector('[class*="statusRailPanel"]')
  const tab = document.querySelector('[class*="statusRailTab"]')
  const t = tab === null ? null : tab.getBoundingClientRect()
  return {
    open: root === null ? null : root.className.includes('statusRailOpen'),
    panelLeft: panel === null ? null : Math.round(panel.getBoundingClientRect().left),
    tabRect: t === null ? null : { x: Math.round(t.left), y: Math.round(t.top), w: Math.round(t.width), h: Math.round(t.height) },
    order: [...document.querySelectorAll('[class*="statusRailSlot"]')].map(el => (el.querySelector('[class*="cardTitle"]')?.textContent ?? '').trim()),
  }
})
console.log('1 初始:', JSON.stringify(await state()))
const s1 = await state()
await page.mouse.click(s1.tabRect.x + s1.tabRect.w / 2, s1.tabRect.y + s1.tabRect.h / 2)
await page.waitForTimeout(600)
console.log('2 点按钮后:', JSON.stringify(await state()))
const rows = await page.evaluate(() => [...document.querySelectorAll('[class*="statusRailSlot"]')].map(el => {
  const card = el.querySelector('[class*="statusRailCard"]'); const r = card.getBoundingClientRect()
  return { title: (card.querySelector('[class*="cardTitle"]')?.textContent ?? '').trim(), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 24) }
}))
if (rows.length >= 2) {
  await page.mouse.move(rows[1].x, rows[1].y)
  await page.mouse.down()
  await page.waitForTimeout(120)
  console.log('3 按下后 floating 数:', await page.evaluate(() => document.querySelectorAll('[class*="statusRailSlotFloating"]').length))
  await page.mouse.move(rows[0].x, rows[0].y - 10, { steps: 12 })
  await page.waitForTimeout(200)
  console.log('4 移动后顺序:', JSON.stringify((await state()).order))
  await page.mouse.up()
  await page.waitForTimeout(300)
  console.log('5 松手后顺序:', JSON.stringify((await state()).order), 'stored:', await page.evaluate(() => window.localStorage.getItem('dsh.mind-map.status-rail.order.v1')))
}
await browser.close(); child.kill()
