import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
const EDGE=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(c=>fs.existsSync(c))
const port=9593
const child=spawn(EDGE,[`--remote-debugging-port=${port}`,`--user-data-dir=${path.join(os.tmpdir(),'lamp-'+Date.now())}`,'--no-first-run','--headless=new','about:blank'],{stdio:'ignore'})
let ready=false; const t0=Date.now()
while(Date.now()-t0<20000&&!ready){ try{ ready=(await fetch(`http://127.0.0.1:${port}/json/version`)).ok }catch{}; if(!ready) await new Promise(r=>setTimeout(r,200)) }
const browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const page=browser.contexts()[0].pages()[0] ?? await browser.contexts()[0].newPage()
await page.setViewportSize({width:1700,height:1050})
await page.goto('file:///'+path.resolve('demo/index.html').replace(/\\/g,'/')+'?demo=1')
await page.waitForTimeout(2500)
const info = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('[data-mindmap-session]')]
  const sample = cards.slice(0, 3).map(card => ({
    text: (card.textContent ?? '').slice(0, 40),
    lampLike: [...card.querySelectorAll('[class*="lamp"], [class*="Lamp"], [data-lamp]')].map(el => el.className || el.getAttribute('data-lamp')),
  }))
  return { cards: cards.length, sample }
})
console.log(JSON.stringify(info, null, 1))
await browser.close(); child.kill()
