import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
const EDGE=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(c=>fs.existsSync(c))
const port=9611
const child=spawn(EDGE,[`--remote-debugging-port=${port}`,`--user-data-dir=${path.join(os.tmpdir(),'dbg6-'+Date.now())}`,'--no-first-run','--headless=new','--window-size=1700,1050','about:blank'],{stdio:'ignore'})
let ready=false; const t0=Date.now()
while(Date.now()-t0<20000&&!ready){ try{ ready=(await fetch(`http://127.0.0.1:${port}/json/version`)).ok }catch{}; if(!ready) await new Promise(r=>setTimeout(r,200)) }
const browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const page=browser.contexts()[0].pages()[0] ?? await browser.contexts()[0].newPage()
await page.setViewportSize({width:1700,height:1050})
await page.goto('file:///'+path.resolve('demo/index.html').replace(/\\/g,'/')+'?demo=1')
await page.waitForTimeout(2500)
const read = () => page.evaluate(() => ({
  cls: document.querySelector('.tm_statusRail')?.className ?? null,
  stored: window.localStorage.getItem('dsh.mind_map.status-rail.open.v1'),
  transform: getComputedStyle(document.querySelector('.tm_statusRailPanel')).transform,
}))
console.log('before:', JSON.stringify(await read()))
await page.click('button.tm_statusRailTab')
await page.waitForTimeout(60)
console.log('+60ms:', JSON.stringify(await read()))
await page.waitForTimeout(400)
console.log('+460ms:', JSON.stringify(await read()))
await page.waitForTimeout(1200)
console.log('+1.7s:', JSON.stringify(await read()))
await browser.close(); child.kill()
