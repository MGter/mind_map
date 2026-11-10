import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
const EDGE=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(c=>fs.existsSync(c))
const port=9607
const child=spawn(EDGE,[`--remote-debugging-port=${port}`,`--user-data-dir=${path.join(os.tmpdir(),'dbg4-'+Date.now())}`,'--no-first-run','--headless=new','--window-size=1700,1050','about:blank'],{stdio:'ignore'})
let ready=false; const t0=Date.now()
while(Date.now()-t0<20000&&!ready){ try{ ready=(await fetch(`http://127.0.0.1:${port}/json/version`)).ok }catch{}; if(!ready) await new Promise(r=>setTimeout(r,200)) }
const browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const page=browser.contexts()[0].pages()[0] ?? await browser.contexts()[0].newPage()
await page.setViewportSize({width:1700,height:1050})
const logs=[]; page.on('console', m => logs.push(m.text().slice(0,120)))
await page.goto('file:///'+path.resolve('demo/index.html').replace(/\\/g,'/')+'?demo=1')
await page.waitForTimeout(2500)
const result = await page.evaluate(() => {
  const tab = document.querySelector('[class*="statusRailTab"]')
  let nativeFired = 0
  tab.addEventListener('click', () => { nativeFired += 1 })
  tab.click()
  return { nativeFired, stored: window.localStorage.getItem('dsh.mind-map.status-rail.open.v1') }
})
console.log('原生监听:', JSON.stringify(result))
await page.waitForTimeout(400)
const after = await page.evaluate(() => ({
  stored: window.localStorage.getItem('dsh.mind-map.status-rail.open.v1'),
  cls: document.querySelector('[class*="statusRail"]').className,
}))
console.log('之后:', JSON.stringify(after))
console.log('console:', logs.slice(-3))
await browser.close(); child.kill()
