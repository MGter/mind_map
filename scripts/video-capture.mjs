/**
 * 视频素材采集：真实插件界面，按视频需要的画面状态高分辨率截图。
 *
 *   node scripts/video-capture.mjs
 *
 * 直接 import 探针的离线 harness（和 test/probe.mjs 同一入口），
 * 产出 video/textures/*.png（1920x1080, 2x）+ video/layout.json。
 */
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'video', 'textures')
fs.mkdirSync(OUT, { recursive: true })

const PORT = 8793
const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`)
  const rel = decodeURIComponent(url.pathname === '/' ? '/test/index.html' : url.pathname)
  const file = path.join(ROOT, rel)
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) {
    response.writeHead(404).end('not found')
    return
  }
  const TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.png': 'image/png', '.json': 'application/json',
  }
  response.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
  response.end(fs.readFileSync(file))
})
await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve))

/** The probe boots the app through harness.js inside the page; reproduce that. */
const bootHtml = await fs.promises.readFile(path.join(ROOT, 'test', 'index.html'), 'utf8')
console.log('harness page size:', bootHtml.length)

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(candidate => fs.existsSync(candidate))
if (EDGE === undefined) throw new Error('msedge not found')
const profileDir = path.join(os.tmpdir(), 'mindmap-video-capture')
fs.rmSync(profileDir, { recursive: true, force: true })
const CDP = 9365
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${profileDir}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--window-size=1920,1080', '--headless=new', 'about:blank',
], { stdio: 'ignore' })

async function waitForCdp(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP}/json/version`)
      if (response.ok) return await response.json()
    } catch { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('no CDP')
}

await waitForCdp()
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP}`)
const context = browser.contexts()[0] ?? await browser.newContext()
const page = context.pages()[0] ?? await context.newPage()
await page.setViewportSize({ width: 1920, height: 1080, deviceScaleFactor: 1 })
await page.goto(`http://127.0.0.1:${PORT}/test/index.html?run=${Date.now()}`)
await page.waitForSelector('.react-flow__node', { timeout: 20000 })
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(1800)

const layout = { viewport: { width: 1920, height: 1080 } }
const shot = async (name, prepare) => {
  if (prepare !== undefined) {
    const ok = await prepare()
    if (ok === false) { console.log('skip:', name); return }
    await page.waitForTimeout(800)
  }
  const file = path.join(OUT, name + '.png')
  await page.screenshot({ path: file })
  layout[name] = { file: name + '.png' }
  console.log('shot:', name)
}

// 1. 开场全景
await shot('board-full')

// 2. 堆叠抽屉：点开一个堆叠格
await shot('drawer', async () => {
  const opener = await page.$('[data-stack-badge], [class*="stackBadge"], [class*="stack"]')
  if (opener === null) return false
  await opener.click()
  await page.waitForSelector('[data-stack-card]', { timeout: 6000 })
  return true
})
await page.keyboard.press('Escape')
await page.waitForTimeout(400)

// 3. 全局搜索
await shot('search', async () => {
  const box = await page.$('input[placeholder*="搜"], input[type="text"]')
  if (box === null) return false
  await box.click()
  await page.waitForTimeout(300)
  await page.keyboard.type('插件', { delay: 60 })
  await page.waitForTimeout(300)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(900)
  return true
})
await page.keyboard.press('Escape')
await page.waitForTimeout(300)


// 4. 卡片光环特写（找运行中/异常的卡片灯）
const ringBox = await page.evaluate(() => {
  const lamp = document.querySelector('[class*="cardLamp"], [class*="lamp"]')
  if (lamp === null) return null
  const rect = lamp.getBoundingClientRect()
  return { x: Math.max(0, rect.x - 80), y: Math.max(0, rect.y - 80), width: rect.width + 160, height: rect.height + 160 }
})
if (ringBox !== null) {
  await page.screenshot({ path: path.join(OUT, 'card-lamp.png'), clip: ringBox })
  layout['card-lamp'] = { file: 'card-lamp.png' }
  console.log('shot: card-lamp')
}
await browser.close()
edge.kill()
server.close()

fs.writeFileSync(path.join(ROOT, 'video', 'layout.json'), JSON.stringify(layout, null, 2), 'utf8')
console.log('done,', Object.keys(layout).length - 1, 'shots')
process.exit(0)
