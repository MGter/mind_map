/**
 * file:// 双击验证：无头 Edge 直接打开 demo/index.html（不经过本地服务器）。
 *   node demo/verify-file.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w):/, '$1:')), '..')
const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(f => fs.existsSync(f))
const profile = path.join(os.tmpdir(), 'mindmap-file-demo')
if (fs.existsSync(profile)) fs.rmSync(profile, { recursive: true, force: true })
const edge = spawn(EDGE, [
  '--remote-debugging-port=9373', `--user-data-dir=${profile}`, '--no-first-run',
  '--allow-file-access-from-files', '--headless=new', '--window-size=1600,1000', 'about:blank',
], { stdio: 'ignore' })

;(async () => {
  const dl = Date.now() + 15000
  while (Date.now() < dl) {
    try { const r = await fetch('http://127.0.0.1:9373/json/version'); if (r.ok) break } catch { /* wait */ }
    await new Promise(r => setTimeout(r, 200))
  }
  const b = await chromium.connectOverCDP('http://127.0.0.1:9373')
  const context = b.contexts()[0] ?? await b.newContext()
  const p = context.pages()[0] ?? await context.newPage()
  const errs = []
  p.on('pageerror', e => errs.push(String(e)))
  await p.setViewportSize({ width: 1600, height: 1000 })
  await p.goto('file:///' + path.join(ROOT, 'demo', 'index.html').replace(/\\/g, '/'))
  await p.waitForSelector('.react-flow__node', { timeout: 15000 })
  await p.waitForTimeout(2200)
  const stats = await p.evaluate(() => ({
    cards: document.querySelectorAll('.react-flow__node').length,
    edges: document.querySelectorAll('.react-flow__edge').length,
    lamps: document.querySelectorAll('[class*="Lamp"], [class*="lamp"]').length,
  }))
  fs.mkdirSync(path.join(ROOT, 'demo', 'shots'), { recursive: true })
  await p.screenshot({ path: path.join(ROOT, 'demo', 'shots', 'real-board.png') })
  const stack = await p.$('[class*="stackBadge"]')
  if (stack !== null) {
    await stack.click()
    await p.waitForTimeout(900)
    stats.drawerCards = await p.evaluate(() => document.querySelectorAll('[data-stack-card]').length)
    await p.screenshot({ path: path.join(ROOT, 'demo', 'shots', 'real-drawer.png') })
    await p.keyboard.press('Escape')
    await p.waitForTimeout(300)
  }
  const box = await p.$('input[class*="globalSearchInput"]') ?? await p.$('input')
  if (box !== null) {
    await box.click()
    await p.keyboard.type('官网', { delay: 50 })
    await p.keyboard.press('Enter')
    await p.waitForTimeout(900)
    stats.gsHits = await p.evaluate(() => document.querySelectorAll('[data-mindmap-search-hit]').length)
    await p.screenshot({ path: path.join(ROOT, 'demo', 'shots', 'real-search.png') })
  }
  console.log(JSON.stringify(stats))
  console.log('errors:', errs.length ? errs.slice(0, 2).join(' | ').slice(0, 240) : 'none')
  await b.close(); edge.kill()
  process.exit(errs.length ? 1 : 0)
})().catch(e => { console.error('FAIL', e.message); edge.kill(); process.exit(1) })
