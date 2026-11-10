import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
const EDGE_BIN = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(c => fs.existsSync(c))
const port = 9514
const child = spawn(EDGE_BIN, [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(os.tmpdir(),'dd-'+Date.now())}`, '--no-first-run','--headless=new','about:blank'], { stdio: 'ignore' })
let ready = false; const t0 = Date.now()
while (Date.now()-t0 < 20000 && !ready) { try { ready = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok } catch {} ; if (!ready) await new Promise(r => setTimeout(r, 200)) }
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const page = browser.contexts()[0].pages()[0] ?? await browser.contexts()[0].newPage()
await page.setViewportSize({ width: 1700, height: 1050 })
await page.goto('file:///' + path.resolve('demo/index.html').replace(/\\/g,'/') + '?demo=1')
await page.waitForTimeout(2500)
await page.evaluate(() => document.querySelector('.tm_stackFace')?.click())
await page.waitForTimeout(1200)
const info = await page.evaluate(() => {
  const scroller = document.querySelector('[class*="drawerScroll"]')
  if (scroller === null) return { drawer: false }
  const kids = [...scroller.children].map(el => el.tagName + '.' + el.className)
  return {
    drawer: true,
    scrollerClass: scroller.className,
    kids: kids.slice(0, 6),
    cards: scroller.querySelectorAll('[data-card-id]').length,
    sessions: scroller.querySelectorAll('[data-mindmap-session]').length,
    paths: scroller.querySelectorAll('svg path').length,
    svgCount: scroller.querySelectorAll('svg').length,
    firstCardTag: [...scroller.querySelectorAll('[class*="card"]')].slice(0,2).map(el => el.className),
  }
})
console.log(JSON.stringify(info, null, 1))
await page.screenshot({ path: 'test/shots/demo-drawer.png' })
await browser.close(); child.kill()
