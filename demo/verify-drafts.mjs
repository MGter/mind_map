/** 抽屉里的卡片是否带"待发送"chip。node demo/verify-drafts.mjs */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w):/, '$1:')), '..')
const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(f => fs.existsSync(f))
const profile = path.join(os.tmpdir(), 'mindmap-demo-drafts')
if (fs.existsSync(profile)) fs.rmSync(profile, { recursive: true, force: true })
const edge = spawn(EDGE, [
  '--remote-debugging-port=9377', `--user-data-dir=${profile}`, '--no-first-run',
  '--headless=new', '--window-size=1600,1000', 'about:blank',
], { stdio: 'ignore' })

;(async () => {
  const dl = Date.now() + 15000
  while (Date.now() < dl) {
    try { const r = await fetch('http://127.0.0.1:9377/json/version'); if (r.ok) break } catch { /* wait */ }
    await new Promise(r => setTimeout(r, 200))
  }
  const b = await chromium.connectOverCDP('http://127.0.0.1:9377')
  const context = b.contexts()[0] ?? await b.newContext()
  const page = context.pages()[0] ?? await context.newPage()
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('file:///' + path.join(ROOT, 'demo', 'index.html').replace(/\\/g, '/'))
  await page.waitForSelector('.react-flow__node', { timeout: 15000 })
  await page.waitForTimeout(2600)
  const boardDrafts = await page.evaluate(() => document.querySelectorAll('[data-mindmap-draft="1"]').length)
  await page.evaluate(() => {
    const badge = document.querySelector('[class*="stackBadge"]')
    if (badge !== null) badge.click()
  })
  await page.waitForTimeout(1000)
  const drawerDrafts = await page.evaluate(() => document.querySelectorAll('[data-stack-card] [data-mindmap-draft="1"]').length)
  await page.screenshot({ path: path.join(ROOT, 'demo', 'shots', 'real-drawer.png') })
  console.log(JSON.stringify({ boardDrafts, drawerDrafts }))
  await b.close(); edge.kill(); process.exit(0)
})().catch(e => { console.error('FAIL', e.message); edge.kill(); process.exit(1) })
