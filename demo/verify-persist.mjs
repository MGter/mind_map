/**
 * demo 专属验收：待发送 chip 存在；拖动卡片后刷新，位置保持（自动保存）。
 *   node demo/verify-persist.mjs
 */
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
const profile = path.join(os.tmpdir(), 'mindmap-demo-persist')
if (fs.existsSync(profile)) fs.rmSync(profile, { recursive: true, force: true })
const edge = spawn(EDGE, [
  '--remote-debugging-port=9375', `--user-data-dir=${profile}`, '--no-first-run',
  '--headless=new', '--window-size=1600,1000', 'about:blank',
], { stdio: 'ignore' })

;(async () => {
  const dl = Date.now() + 15000
  while (Date.now() < dl) {
    try { const r = await fetch('http://127.0.0.1:9375/json/version'); if (r.ok) break } catch { /* wait */ }
    await new Promise(r => setTimeout(r, 200))
  }
  const b = await chromium.connectOverCDP('http://127.0.0.1:9375')
  const context = b.contexts()[0] ?? await b.newContext()
  const page = context.pages()[0] ?? await context.newPage()
  const errs = []
  page.on('pageerror', e => errs.push(String(e)))
  await page.setViewportSize({ width: 1600, height: 1000 })
  const url = 'file:///' + path.join(ROOT, 'demo', 'index.html').replace(/\\/g, '/')
  await page.goto(url)
  await page.waitForSelector('.react-flow__node', { timeout: 15000 })
  await page.waitForTimeout(2600)

  const drafts = await page.evaluate(() => document.querySelectorAll('[data-mindmap-draft="1"]').length)

  // 拖一张自由卡到空白处
  const handle = await page.$('[data-mindmap-session="s23"]')
  const box = await handle.boundingBox()
  await page.mouse.move(box.x + 60, box.y + 20)
  await page.mouse.down()
  await page.mouse.move(box.x + 320, box.y + 240, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(1200) // flush timer is 500ms
  const moved = await page.evaluate(() => {
    const node = document.querySelector('[data-mindmap-session="s23"]')
    const r = node.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y) }
  })

  // 刷新：位置应保持
  await page.reload()
  await page.waitForSelector('.react-flow__node', { timeout: 15000 })
  await page.waitForTimeout(2200)
  const after = await page.evaluate(() => {
    const node = document.querySelector('[data-mindmap-session="s23"]')
    const r = node.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y) }
  })
  const saved = await page.evaluate(() => {
    const raw = window.localStorage.getItem('mind_map.demo-state.v1')
    return raw !== null ? JSON.parse(raw).cards !== undefined : false
  })
  const draftsAfter = await page.evaluate(() => document.querySelectorAll('[data-mindmap-draft="1"]').length)

  console.log(JSON.stringify({ drafts, draftsAfter, moved, after, saved, held: Math.abs(moved.x - after.x) < 4 && Math.abs(moved.y - after.y) < 4 }))
  console.log('errors:', errs.length ? errs.slice(0, 2).join(' | ').slice(0, 240) : 'none')
  await b.close(); edge.kill()
  process.exit(errs.length ? 1 : 0)
})().catch(e => { console.error('FAIL', e.message); edge.kill(); process.exit(1) })
