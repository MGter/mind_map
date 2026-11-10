import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
const EDGE=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(c=>fs.existsSync(c))
const port=9615
const child=spawn(EDGE,[`--remote-debugging-port=${port}`,`--user-data-dir=${path.join(os.tmpdir(),'dbg8-'+Date.now())}`,'--no-first-run','--headless=new','--window-size=1700,1050','about:blank'],{stdio:'ignore'})
let ready=false; const t0=Date.now()
while(Date.now()-t0<20000&&!ready){ try{ ready=(await fetch(`http://127.0.0.1:${port}/json/version`)).ok }catch{}; if(!ready) await new Promise(r=>setTimeout(r,200)) }
const browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const page=browser.contexts()[0].pages()[0] ?? await browser.contexts()[0].newPage()
await page.setViewportSize({width:1700,height:1050})
await page.goto('file:///'+path.resolve('demo/index.html').replace(/\\/g,'/')+'?demo=1')
await page.waitForTimeout(2500)
await page.click('button.tm_statusRailTab')
await page.waitForTimeout(500)
const rows = await page.evaluate(() => [...document.querySelectorAll('.tm_statusRailSlot')].map(el => {
  const card = el.querySelector('.tm_statusRailCard'); const r = card.getBoundingClientRect()
  return { title: card.querySelector('.tm_cardTitle')?.textContent?.trim(), x: Math.round(r.left + r.width/2), y: Math.round(r.top + 30) }
}))
console.log('rows:', JSON.stringify(rows.map(r => r.title)))
await page.mouse.move(rows[1].x, rows[1].y)
await page.mouse.down()
await page.waitForTimeout(150)
console.log('按下后 floating:', await page.evaluate(() => document.querySelectorAll('.tm_statusRailSlotFloating').length), 'data-open:', await page.evaluate(() => document.querySelector('.tm_statusRail')?.getAttribute('data-open')))
await page.mouse.move(rows[0].x, rows[0].y - 20, { steps: 15 })
await page.waitForTimeout(250)
console.log('移动后顺序:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.tm_statusRailSlot .tm_cardTitle')].map(el => el.textContent?.trim()))))
await page.mouse.up()
await page.waitForTimeout(300)
console.log('松手后顺序:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.tm_statusRailSlot .tm_cardTitle')].map(el => el.textContent?.trim()))))
console.log('stored:', await page.evaluate(() => window.localStorage.getItem('dsh.mind_map.status-rail.order.v1')))
await browser.close(); child.kill()
