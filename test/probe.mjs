/**
 * Headless-Edge probe for the mind-map client bundle.
 *
 * Runs the real built artifact in a throwaway headless Edge (own --user-data-dir,
 * own debugging port) and asserts the behaviours this project cares about.
 * Never touches the user's browser profile.
 *
 *   node test/probe.mjs            # boots Edge + static server itself
 *   node test/probe.mjs --headed   # same, with a visible window
 *
 * Exit code 0 = every check passed; 1 = at least one FAIL (listed at the end).
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import { chromium } from 'playwright-core'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(candidate => fs.existsSync(candidate))
const PORT = 8791
const CDP = 9333
const headed = process.argv.includes('--headed')
const profileDir = path.join(os.tmpdir(), 'mindmap-edge-profile')
const shots = path.join(ROOT, 'test/shots')

const results = []
function check(name, passed, detail) {
  results.push({ name, passed, detail })
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  — ${detail}`}`)
}

// ---- static server ------------------------------------------------------
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
}
const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`)
  const rel = decodeURIComponent(url.pathname === '/' ? '/test/index.html' : url.pathname)
  const file = path.join(ROOT, rel)
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) {
    response.writeHead(404).end('not found')
    return
  }
  response.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
  response.end(fs.readFileSync(file))
})
await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve))

// ---- headless Edge ------------------------------------------------------
if (EDGE === undefined) throw new Error('Microsoft Edge not found')
fs.rmSync(profileDir, { recursive: true, force: true })
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${profileDir}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-sync',
  '--window-size=1600,1000',
  ...(headed ? [] : ['--headless=new']),
  'about:blank',
], { stdio: 'ignore', detached: false })

async function waitForCdp(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP}/json/version`)
      if (response.ok) return await response.json()
    } catch { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error('headless Edge did not expose CDP in time')
}

let browser
let failures = 0
const consoleErrors = []
try {
  const version = await waitForCdp()
  console.log(`Edge ${version.Browser} via CDP :${CDP}\n`)
  fs.mkdirSync(shots, { recursive: true })
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP}`)
  const context = browser.contexts()[0] ?? await browser.newContext()
  const page = context.pages()[0] ?? await context.newPage()
  page.on('pageerror', error => consoleErrors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  const box = async (selector) => page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (el === null) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
  }, selector)
  const cardPoint = async (sessionId) => page.evaluate((sid) => {
    const state = window.__harness.state()
    const el = [...document.querySelectorAll('.react-flow__node')]
      .find(node => state.cards[node.getAttribute('data-id')]?.sessionId === sid)
    if (el === undefined || el === null) return null
    const r = el.getBoundingClientRect()
    return { x: r.x + 40, y: r.y + 14 }
  }, sessionId)
  const menuItems = () => page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].map(el => el.textContent.trim()))
  const clickMenuItem = async (needle) => {
    await page.evaluate((text) => {
      const target = [...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent.includes(text))
      target?.click()
    }, needle)
    await page.waitForTimeout(500)
  }
  const openMap = async () => {
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', code: 'KeyF', altKey: true })))
    await page.waitForTimeout(600)
  }

  // The plugin persists lamp state and previews in localStorage; a previous run's
  // leftovers would poison this one, so start from a clean slate.
  // One-shot: later navigations in this run (reload / cache test) must keep what
  // the run has stored.
  await page.addInitScript(() => {
    // Per-run marker: this browser tab is reused between runs, so a fixed flag
    // would skip the reset on every run after the first.
    const run = new URLSearchParams(location.search).get('run') ?? '0'
    if (sessionStorage.getItem('probe-run') === run) return
    sessionStorage.setItem('probe-run', run)
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('dsh.mind-map.')) localStorage.removeItem(key)
    }
  })
  await page.goto(`http://127.0.0.1:${PORT}/test/index.html?run=${Date.now()}`)
  // A backgrounded tab does not update :hover or run compositor animations.
  await page.bringToFront()
  await page.waitForSelector('.react-flow__node', { timeout: 10000 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: path.join(shots, 'probe-initial.png') })

  // ---- 0b. header: font size controls, no language switch ----------------
  const headerButtons = await page.evaluate(() => ({
    font: document.querySelectorAll('[class*="fontButton"]').length,
    lang: document.querySelectorAll('[class*="langButton"]').length,
    sizes: [...document.querySelectorAll('[class*="fontButton"]')].map(node => node.textContent.trim()),
  }))
  check('右上角有 3 个字号按钮（加 / 减 / 默认）',
    headerButtons.font === 3 && headerButtons.sizes.join('|').includes('+') && headerButtons.sizes.join('|').includes('−'),
    JSON.stringify(headerButtons))
  check('语言切换按钮已移除', headerButtons.lang === 0, String(headerButtons.lang))
  const controlsState = await page.evaluate(() => ({
    buttons: document.querySelectorAll('[class*="react-flow__controls-button"]').length,
    toggle: document.querySelector('[class*="react-flow__controls"] [aria-pressed]') !== null,
  }))
  const fontAlign = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('[class*="fontButton"]')]
    const boxes = buttons.map(node => node.getBoundingClientRect())
    const centers = buttons.map(node => {
      const glyph = node.querySelector('span')
      if (glyph === null) return null
      const r = glyph.getBoundingClientRect()
      return Math.round(r.y + r.height / 2)
    })
    return {
      heights: boxes.map(b => Math.round(b.height)),
      tops: boxes.map(b => Math.round(b.y)),
      centers,
    }
  })
  check('A− / A+ 两个按钮同高同位（不再东倒西歪）',
    fontAlign.heights.every(h => h === fontAlign.heights[0]) && fontAlign.tops.every(t => t === fontAlign.tops[0]),
    JSON.stringify(fontAlign))
  const fontShot = await page.evaluate(() => {
    const group = document.querySelector('[class*="fontGroup"]')
    const r = group.getBoundingClientRect()
    return { x: Math.round(r.x - 8), y: Math.round(r.y - 8), width: Math.round(r.width + 16), height: Math.round(r.height + 16) }
  })
  await page.screenshot({ path: path.join(shots, 'probe-font-buttons.png'), clip: fontShot })

  check('左下角没有模式切换按钮（只剩缩放/适配/1:1）',
    controlsState.toggle === false && controlsState.buttons === 4, JSON.stringify(controlsState))

  const sampleFont = () => page.evaluate(() => {
    const node = document.querySelector('.react-flow__node [data-mindmap-session] [class*="cardTitle"]')
      ?? document.querySelector('[class*="cardTitle"]')
    return node === null ? null : parseFloat(getComputedStyle(node).fontSize)
  })
  const baseFont = await sampleFont()
  await page.click('[class*="fontButton"]:nth-of-type(2)')
  await page.waitForTimeout(250)
  const biggerFont = await sampleFont()
  await page.click('[class*="fontButton"]:nth-of-type(1)')
  await page.click('[class*="fontButton"]:nth-of-type(1)')
  await page.waitForTimeout(250)
  const smallerFont = await sampleFont()
  await page.click('[class*="fontButton"]:nth-of-type(3)')
  await page.waitForTimeout(250)
  const resetFont = await sampleFont()
  check('点「加」→ 每项字号 +1', biggerFont === baseFont + 1, String(baseFont) + ' → ' + String(biggerFont))
  check('点两次「减」→ 每项字号 −1', smallerFont === baseFont - 1, String(baseFont) + ' → ' + String(smallerFont))
  check('点「默认」→ 回到原始字号', resetFont === baseFont, String(baseFont) + ' → ' + String(resetFont))

  // ---- 0c. global search lives in the header ---------------------------
  const globalBox = await box('[data-mindmap-global-search]')
  check('右上角有全局搜索框（在字体按钮左边）', globalBox !== null, JSON.stringify(globalBox))
  const callsBeforeTyping = await page.evaluate(() => window.__harness.searchRouteCalls().length)
  await page.fill('[data-mindmap-global-search]', '物理')
  await page.waitForTimeout(500)
  const callsAfterTyping = await page.evaluate(() => window.__harness.searchRouteCalls().length)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(900)
  const globalPanel = await page.evaluate(() => ({
    open: document.querySelector('[class*="globalSearchPanel"]') !== null,
    hits: document.querySelectorAll('[data-mindmap-search-hit]').length,
  }))
  const globalScope = await page.evaluate(() => window.__harness.searchRouteScopes().at(-1))
  // Titles are searched too (client-side, the board knows every title).
  await page.fill('[data-mindmap-global-search]', '标注工具离线化')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(900)
  const titleHits = await page.evaluate(() => ({
    chips: document.querySelectorAll('[data-mindmap-title-hit]').length,
    sessions: [...document.querySelectorAll('[data-mindmap-search-hit]')].map(node => node.getAttribute('data-mindmap-search-hit')),
  }))
  await page.screenshot({ path: path.join(shots, 'probe-global-search.png') })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(350)
  const globalPanelClosed = await page.evaluate(() => document.querySelector('[class*="globalSearchPanel"]') === null)
  check('Esc 关闭全局搜索面板', globalPanelClosed === true, String(globalPanelClosed))

  // ---- 1. header -------------------------------------------------------
  const header = await page.evaluate(() => {
    const read = (el) => {
      if (el === null) return null
      const r = el.getBoundingClientRect()
      return { w: Math.round(r.width), h: Math.round(r.height), text: el.textContent.trim() }
    }
    return {
      back: read(document.querySelector('[class*="tm_backButton"]')),
      close: read(document.querySelector('[class*="tm_closeButton"]')),
      title: document.querySelector('[class*="headerTitle"]') !== null,
      hotkey: document.querySelector('[class*="tm_hotkeyButton"]') !== null,
      fullscreen: document.querySelector('[class*="tm_fullscreenButton"]') !== null,
      topGap: (() => {
        const panel = document.querySelector('[class*="tm_panel"]')
        const head = document.querySelector('[class*="tm_header"]')
        if (panel === null || head === null) return null
        return Math.round(head.getBoundingClientRect().top - panel.getBoundingClientRect().top)
      })(),
    }
  })
  check('左上角是返回按钮', header.back !== null && header.back.text.includes('返回'), JSON.stringify(header.back))
  check('右上角是关闭按钮', header.close !== null, JSON.stringify(header.close))
  check('按钮放大了（≥34px 高）', (header.back?.h ?? 0) >= 34 && (header.close?.h ?? 0) >= 34, `${header.back?.h}px / ${header.close?.h}px`)
  check('标题文字已删除', header.title === false)
  check('快捷键按钮已删除', header.hotkey === false)
  check('全屏按钮已删除', header.fullscreen === false)
  check('顶部没有多余空白', header.topGap !== null && header.topGap <= 6, `差值 ${header.topGap}px`)

  // ---- 2. sidebar follows the map --------------------------------------
  const sidebarOpen = await page.evaluate(() => window.__harness.sidebarState())
  check('打开地图时侧栏自动收起', sidebarOpen.collapsed === true && sidebarOpen.width < 80, JSON.stringify(sidebarOpen))
  await page.click('[class*="tm_backButton"]')
  await page.waitForTimeout(400)
  const sidebarBack = await page.evaluate(() => window.__harness.sidebarState())
  check('返回对话时侧栏自动展开', sidebarBack.collapsed === false && sidebarBack.width > 150, JSON.stringify(sidebarBack))
  await openMap()
  check('再次打开仍会收起侧栏', (await page.evaluate(() => window.__harness.sidebarState())).collapsed === true)


  // 卡片真实渲染尺寸：布局常量是 224×120，但高度由内容决定——连线避障要用真实值
  const nodeSizes = await page.evaluate(() => {
    const sizes = [...document.querySelectorAll('.react-flow__node')]
      .filter(node => node.querySelector('[data-mindmap-session]') !== null)
      .map(node => {
        const box = node.getBoundingClientRect()
        return { w: Math.round(box.width), h: Math.round(box.height) }
      })
    const heights = sizes.map(size => size.h)
    return {
      count: sizes.length,
      widths: [...new Set(sizes.map(size => size.w))].slice(0, 4),
      min: heights.length > 0 ? Math.min(...heights) : null,
      max: heights.length > 0 ? Math.max(...heights) : null,
    }
  })
  check('卡片真实尺寸（连线避障的依据）', nodeSizes.count > 0, JSON.stringify(nodeSizes))

  // ---- 3. grid ---------------------------------------------------------
  const grid = await page.evaluate(() => {
    const cards = []
    for (const el of document.querySelectorAll('.react-flow__node')) {
      const id = el.getAttribute('data-id')
      if (!id || id.startsWith('frame-') || id.startsWith('stack-')) continue
      const r = el.getBoundingClientRect()
      cards.push({ id, x: r.x, y: r.y, w: r.width, h: r.height })
    }
    const overlaps = []
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        const a = cards[i], b = cards[j]
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlaps.push([a.id, b.id])
      }
    }
    return { count: cards.length, overlaps }
  })
  check('卡片互不重叠', grid.overlaps.length === 0, `${grid.count} 张可见卡，重叠 ${grid.overlaps.length} 对`)

  const autoSync = await page.evaluate(() =>
    [...document.querySelectorAll('.react-flow__node [class*="cardTitle"]')]
      .map(el => el.textContent.trim())
      .includes('自动同步进来的会话'))
  check('打开地图时自动同步新会话', autoSync === true)

  // ---- 3b2. a whole NEW workspace also arrives without a folder ----------
  await page.click('[class*="tm_backButton"]')
  await page.waitForTimeout(300)
  await page.evaluate(() => window.__harness.addWorkspace('ws-imported', '新导入的工作区', 's30', '导入进来的会话'))
  await openMap()
  await page.waitForTimeout(900)
  const importedFrame = await page.evaluate(() => {
    const frame = document.querySelector('[data-mindmap-workspace="ws-imported"]')
    if (frame === null) return null
    const card = document.querySelector('[data-mindmap-session="s30"]')
    const box = frame.getBoundingClientRect()
    // Overlap against every other folder: a new folder must not be dropped on top.
    const others = [...document.querySelectorAll('[data-mindmap-frame]')]
      .filter(node => node.getAttribute('data-mindmap-workspace') !== 'ws-imported')
      .map(node => node.getBoundingClientRect())
    const overlaps = others.some(other => !(box.right <= other.left + 1 || box.left >= other.right - 1
      || box.bottom <= other.top + 1 || box.top >= other.bottom - 1))
    return { frame: true, card: card !== null, overlaps }
  })
  check('新工作区自动长出一个文件夹', importedFrame?.frame === true, JSON.stringify(importedFrame))
  check('新工作区里的会话有卡片', importedFrame?.card === true, JSON.stringify(importedFrame))
  check('新文件夹不和已有文件夹重叠', importedFrame?.overlaps === false, JSON.stringify(importedFrame))

  // ---- 3b. status chip text + colour follow the lamp -------------------
  const readChips = () => page.evaluate(() => {
    const out = {}
    // Grid cards and drawer cards both carry the session id, so one scan covers
    // whichever surface is on screen.
    for (const root of document.querySelectorAll('[data-mindmap-session]')) {
      const sessionId = root.getAttribute('data-mindmap-session')
      const chip = root.querySelector('[data-mindmap-chip]')
      out[sessionId] = chip === null
        ? null
        : {
            kind: chip.getAttribute('data-mindmap-chip'),
            text: chip.textContent.trim(),
            color: getComputedStyle(chip).color,
          }
    }
    return out
  })
  const chips = await readChips()
  check('运行中 → 文字「正在运行」白色',
    chips.s1?.text === '正在运行' && chips.s1.color === 'rgb(255, 255, 255)', JSON.stringify(chips.s1))
  check('等你回复 → 文字「等你回复」琥珀',
    chips.s2?.text === '等你回复' && /245, 178, 46/.test(chips.s2?.color ?? ''), JSON.stringify(chips.s2))
  await page.evaluate(() => window.__harness.raiseError('s2'))
  await page.waitForTimeout(500)
  const afterError = await readChips()
  check('异常终止 → 文字「异常终止」红色',
    afterError.s2?.text === '异常终止' && /242, 78, 78/.test(afterError.s2?.color ?? ''), JSON.stringify(afterError.s2))

  // ---- 3d. unsent composer text → grey "待发送" badge -------------------
  // The shell persists per-session drafts in localStorage; the map reads the same
  // store (see draft-watch.ts) and polls it while the panel is open.
  const draftSession = await page.evaluate(() => {
    const state = window.__harness.state()
    const entry = [...document.querySelectorAll('.react-flow__node')]
      .map(el => ({ id: el.getAttribute('data-id'), r: el.getBoundingClientRect() }))
      .filter(item => state.cards[item.id] !== undefined)
      .sort((a, b) => (a.r.y - b.r.y) || (a.r.x - b.r.x))[0]
    return entry === undefined ? null : state.cards[entry.id].sessionId
  })
  await page.evaluate((id) => {
    localStorage.setItem('dsh.conversation.' + id, JSON.stringify({ draft: '还没发出去的一句话', view: null }))
  }, draftSession)
  await page.waitForTimeout(2200)
  const draftBadge = await page.evaluate((id) => {
    const badge = document.querySelector('[data-mindmap-session="' + id + '"] [data-mindmap-draft]')
    return badge === null ? null : { text: badge.textContent.trim(), color: getComputedStyle(badge).color }
  }, draftSession)
  check('输入框有未发送文字 → 卡片带黄标「待发送」',
    draftBadge?.text === '待发送' && /255, 197, 61/.test(draftBadge?.color ?? ''),
    `${JSON.stringify(draftBadge)} for ${draftSession}`)
  await page.evaluate((id) => { localStorage.removeItem('dsh.conversation.' + id) }, draftSession)
  await page.waitForTimeout(2200)
  check('发出去/清空后黄标消失',
    await page.evaluate(() => document.querySelector('[data-mindmap-draft]') === null))

  // ---- 3e. quiet cards / particles / card body -------------------------
  const quietCard = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('.react-flow__node [data-mindmap-session]')]
    const quiet = nodes.find(node => node.className.includes('tm_cardQuiet'))
    if (quiet === undefined) return null
    const r = quiet.getBoundingClientRect()
    // Hover only lands if the pointer can actually reach the card (another node,
    // a frame strip or a drawer can sit on top), so probe a few points.
    const inside = (x, y) => {
      const hit = document.elementFromPoint(x, y)
      return hit !== null && (hit === quiet || quiet.contains(hit))
    }
    let point = null
    for (const fy of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      for (const fx of [0.5, 0.3, 0.7]) {
        const x = Math.round(r.x + r.width * fx)
        const y = Math.round(r.y + r.height * fy)
        if (inside(x, y)) { point = { x, y }; break }
      }
      if (point !== null) break
    }
    return {
      dimmed: Number(getComputedStyle(quiet).opacity),
      point,
    }
  })
  check('没有任何状态的卡片被压暗', quietCard !== null && quietCard.dimmed < 0.75,
    JSON.stringify(quietCard))
  if (quietCard?.point != null) {
    await page.mouse.move(quietCard.point.x, quietCard.point.y)
    await page.waitForTimeout(300)
    const hovered = await page.evaluate(() => {
      const node = [...document.querySelectorAll('.react-flow__node [data-mindmap-session]')]
        .find(item => item.className.includes('tm_cardQuiet'))
      return node === undefined ? null : Number(getComputedStyle(node).opacity)
    })
    check('悬浮时恢复原样', hovered === 1, String(hovered))
    await page.mouse.move(5, 5)
    await page.waitForTimeout(200)
  }

  const runningFx = await page.evaluate(() => {
    const card = document.querySelector('[data-mindmap-session="s1"]')
    if (card === null) return null
    const particles = card.querySelectorAll('[class*="cardParticles"] i')
    const layer = card.querySelector('[class*="cardParticles"]')
    return {
      count: particles.length,
      layerZ: layer === null ? null : getComputedStyle(layer).zIndex,
      size: particles.length === 0 ? null : parseFloat(getComputedStyle(particles[0]).width),
      animation: particles.length === 0 ? null : getComputedStyle(particles[0]).animationName,
      body: card.querySelector('[class*="cardSummary"]')?.textContent?.trim() ?? null,
    }
  })
  check('粒子效果已移除', (runningFx?.count ?? 0) === 0 && runningFx?.layerZ === null,
    JSON.stringify({ count: runningFx?.count, layerZ: runningFx?.layerZ }))
  // Session-list churn must not starve the body request (the real app repaints
  // the list every second while a turn runs), and the body must land fast — the
  // request is kicked as soon as the cards exist, not on the next poll tick.
  await page.evaluate(() => window.__harness.churn(true))
  await page.click('[class*="tm_backButton"]')
  await page.waitForTimeout(300)
  const startedAt = Date.now()
  await openMap()
  let bodyUnderChurn = null
  let waited = 0
  for (let attempt = 0; attempt < 25; attempt += 1) {
    bodyUnderChurn = await page.evaluate(() => {
      const card = document.querySelector('[data-mindmap-session="s1"]')
      return card === null ? null : (card.querySelector('[class*="cardSummary"]')?.textContent ?? null)
    })
    if (bodyUnderChurn !== null) break
    await page.waitForTimeout(100)
    waited += 100
  }
  const bodyLatency = Date.now() - startedAt
  await page.evaluate(() => window.__harness.churn(false))
  check('列表高频刷新时正文仍然取到', bodyUnderChurn === '把卡片改成网格槽位，含退让与补位动画', JSON.stringify(bodyUnderChurn))
  check('正文在打开地图后 1.5s 内出现', bodyLatency < 1500, `${bodyLatency}ms（poll 等待 ${waited}ms）`)
  // Cache first: with the route slowed to 2s, a reopen must still paint the body
  // immediately (it comes from localStorage, not the network).
  // A reload resets the module (cold memory) but keeps localStorage: that is a
  // real app restart for the cache's purposes.
  // The query string slows the body route BEFORE the page boots, so the very
  // first fetch (which the boot already triggers) is the slow one.
  // Cache first: the route is slowed to 2s from boot, so anything visible at
  // ~500ms can only have come from localStorage.
  // Keep the run marker: it is what stops the init script from wiping the cache.
  await page.goto(page.url() + (page.url().includes('?') ? '&' : '?') + 'slowPreviews=2000')
  await page.waitForTimeout(500)
  const cachedStart = Date.now()
  const cachedBody = await page.evaluate(() => {
    const card = document.querySelector('[data-mindmap-session="s1"]')
    return card === null ? null : (card.querySelector('[class*="cardSummary"]')?.textContent ?? null)
  })
  const cachedLatency = Date.now() - cachedStart
  // …and the background refresh still lands, for when the cache is cold.
  await page.waitForTimeout(2200)
  const refreshedBody = await page.evaluate(() => {
    const card = document.querySelector('[data-mindmap-session="s1"]')
    return card === null ? null : (card.querySelector('[class*="cardSummary"]')?.textContent ?? null)
  })
  check('正文来自本地缓存：接口慢到 2s 也立刻显示',
    cachedBody === '把卡片改成网格槽位，含退让与补位动画',
    JSON.stringify(cachedBody) + ' / ' + String(cachedLatency) + 'ms')
  check('缓存之外的后台刷新仍然生效',
    refreshedBody === '把卡片改成网格槽位，含退让与补位动画', JSON.stringify(refreshedBody))

  check('卡片上不再有「下一步」那一行',
    await page.evaluate(() => document.querySelectorAll('[class*="cardNext"]').length === 0))

  check('卡片正文 = 用户最后发的那句话（不是摘要）',
    runningFx?.body === '把卡片改成网格槽位，含退让与补位动画', JSON.stringify(runningFx?.body))
  // ---- 3c. a brand-new conversation takes the head of its folder -------
  await page.evaluate(() => window.__harness.addSession('ws-daily', 's11', '刚刚新建的对话'))
  await page.click('[class*="tm_backButton"]')
  await page.waitForTimeout(400)
  await openMap()
  const headOrder = await page.evaluate(() => {
    const state = window.__harness.state()
    // Global reading order: the daily folder is the top-left one, so its first
    // slot is the board's first card.
    return [...document.querySelectorAll('.react-flow__node')]
      .map(el => ({ id: el.getAttribute('data-id'), r: el.getBoundingClientRect() }))
      .filter(entry => state.cards[entry.id] !== undefined)
      .sort((a, b) => (a.r.y - b.r.y) || (a.r.x - b.r.x))
      .map(entry => state.cards[entry.id].sessionId)
  })
  check('新建的对话排到文件夹最前', headOrder[0] === 's11', JSON.stringify(headOrder.slice(0, 3)))

  // ---- 4. overflow stack + drawer -------------------------------------
  const stack = await page.evaluate(() => {
    const el = document.querySelector('.react-flow__node[data-id^="stack-"]')
    if (el === null) return null
    const r = el.getBoundingClientRect()
    const badge = el.querySelector('[class*="stackBadge"]')
    const frames = window.__harness.nodeBoxes().frames['ws-daily']
    return {
      badge: badge?.textContent ?? '',
      rightGap: Math.round(frames.x + frames.w - (r.x + r.width)),
      bottomGap: Math.round(frames.y + frames.h - (r.y + r.height)),
    }
  })
  check('装不下时出现堆叠格子', stack !== null && stack.badge === '+4', JSON.stringify(stack))
  const stackDim = await page.evaluate(() => {
    const cell = document.querySelector('[class*="tm_stackCell"]')
    if (cell === null) return null
    const r = cell.getBoundingClientRect()
    return {
      dimmed: Number(getComputedStyle(cell).opacity),
      point: { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) },
    }
  })
  check('堆叠格子同样被压暗', stackDim !== null && stackDim.dimmed < 0.75, JSON.stringify(stackDim))
  if (stackDim !== null) {
    await page.mouse.move(stackDim.point.x, stackDim.point.y)
    await page.waitForTimeout(250)
    check('堆叠格子悬浮恢复', await page.evaluate(() => {
      const cell = document.querySelector('[class*="tm_stackCell"]')
      return cell !== null && Number(getComputedStyle(cell).opacity) === 1
    }))
    await page.mouse.move(5, 5)
    await page.waitForTimeout(200)
  }
  check('堆叠格子落在文件夹右下角', stack !== null && stack.rightGap >= 10 && stack.rightGap <= 48 && stack.bottomGap >= 0 && stack.bottomGap <= 72,
    `右 ${stack?.rightGap}px / 下 ${stack?.bottomGap}px`)

  await page.click('.react-flow__node[data-id^="stack-"] [class*="stackFace"]')
  await page.waitForTimeout(400)
  const drawer = await page.evaluate(() => {
    const el = document.querySelector('[class*="tm_drawer"]:not([class*="Backdrop"])')
    if (el === null) return null
    const cards = [...el.querySelectorAll('[data-stack-card]')]
    const tops = new Set(cards.map(card => card.offsetTop))
    // Running = steady faint halo + a spinning ring (::after); the other lamps
    // are breathing shadows.
    const withRing = cards
      .map(card => ({
        ring: getComputedStyle(card, '::after').animationName,
        animation: getComputedStyle(card).animationName,
        shadow: getComputedStyle(card).boxShadow,
      }))
      .find(entry => entry.ring.includes('ring-sweep')) ?? null
    return {
      count: cards.length,
      width: cards[0] === undefined ? 0 : Math.round(cards[0].getBoundingClientRect().width),
      rows: tops.size,
      runningRing: withRing !== null,
      runningCard: withRing,
      doneBreath: cards.some(card => getComputedStyle(card).animationName.includes('lamp-green')),
      chipCount: el.querySelectorAll('[data-mindmap-chip]').length,
    }
  })
  check('点堆叠格子打开抽屉，列出全部对话', drawer?.count === 6, `${drawer?.count} 张`)
  check('抽屉里的卡片是 1:1 尺寸（224px）', drawer?.width === 224, `${drawer?.width}px`)
  check('抽屉里至少两行（卡片排满整行再换行）', (drawer?.rows ?? 0) >= 2, `rows=${drawer?.rows}`)
  const drawerQuiet = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-stack-card]')]
    const dim = cards.filter(node => Number(getComputedStyle(node).opacity) < 0.75).length
    const lit = cards.filter(node => Number(getComputedStyle(node).opacity) >= 0.99).length
    return { total: cards.length, dim, lit }
  })
  check('抽屉里无状态的卡片同样压暗（有状态的保持原样）',
    drawerQuiet.dim >= 1 && drawerQuiet.lit >= 1, JSON.stringify(drawerQuiet))

  check('运行中 = 环绕卡片的加载光环', drawer?.runningRing === true)
  check('已完成 = 绿光呼吸', drawer?.doneBreath === true)
  check('抽屉里的卡片也带状态胶囊', (drawer?.chipCount ?? 0) >= 3, `chips=${drawer?.chipCount}`)
  check('运行中不呼吸（没有 pulse 动画）', !(drawer?.runningCard?.animation ?? '').includes('lamp'), drawer?.runningCard?.animation)
  check('运行中是微弱白光（不是大范围光晕）', (() => {
    const alphas = [...(drawer?.runningCard?.shadow ?? '').matchAll(/rgba\(255, 255, 255, ([\d.]+)\)/g)].map(match => Number(match[1]))
    return alphas.length > 0 && Math.max(...alphas) <= 0.45
  })(), (drawer?.runningCard?.shadow ?? '').slice(0, 90))

  const ringMotion = await page.evaluate(async () => {    const cards = [...document.querySelectorAll('[data-stack-card]')]
    const card = cards.find(node => getComputedStyle(node, '::after').animationName.includes('ring-sweep'))
    if (card === undefined) return null
    const angle1 = getComputedStyle(card, '::after').getPropertyValue('--tm-ring-angle').trim()
    await new Promise(resolve => setTimeout(resolve, 400))
    const after = getComputedStyle(card, '::after')
    return {
      angle1,
      angle2: after.getPropertyValue('--tm-ring-angle').trim(),
      transform: after.transform,
    }
  })
  check('光环是流光（渐变角在动，环本身不转）',
    ringMotion !== null && ringMotion.transform === 'none' && ringMotion.angle1 !== ringMotion.angle2,
    JSON.stringify(ringMotion))
  // Close-up of the running card, for eyeballing the sweep. Padded, because the
  // ring is drawn 2px OUTSIDE the card box (element screenshots clip to the box).
  const runningBox = await page.evaluate(() => {
    const card = [...document.querySelectorAll('[data-stack-card]')]
      .find(node => getComputedStyle(node, '::after').animationName.includes('ring-sweep'))
    if (card === undefined) return null
    const r = card.getBoundingClientRect()
    const style = getComputedStyle(card, '::after')
    return {
      clip: { x: r.x - 12, y: r.y - 12, width: r.width + 24, height: r.height + 24 },
      bg: style.backgroundImage.slice(0, 60),
      composite: style.maskComposite,
    }
  })
  if (runningBox !== null) {
    await page.screenshot({ path: path.join(shots, 'probe-ring.png'), clip: runningBox.clip })
  }

  const drawerGrid = await page.evaluate(() => {
    const panel = document.querySelector('[class*="tm_drawer"]:not([class*="Backdrop"])')
    const cards = [...document.querySelectorAll('[data-stack-card]')]
    const firstTop = Math.min(...cards.map(card => card.offsetTop))
    return {
      width: panel === null ? 0 : Math.round(panel.getBoundingClientRect().width),
      firstRow: cards.filter(card => card.offsetTop === firstTop).length,
      total: cards.length,
    }
  })
  check('抽屉是多列网格（不是一列）', drawerGrid.firstRow >= 2, JSON.stringify(drawerGrid))
  check('抽屉更宽（≥900px）', drawerGrid.width >= 900, `${drawerGrid.width}px`)

  const scrollBefore = await page.evaluate(() => {
    const scroller = document.querySelector('[class*="drawerScroll"]')
    return { top: scroller.scrollTop, overflow: scroller.scrollHeight > scroller.clientHeight + 4 }
  })
  const scrollBox = await box('[class*="drawerScroll"]')
  await page.mouse.move(scrollBox.x + scrollBox.w / 2, scrollBox.y + scrollBox.h / 2)
  await page.mouse.wheel(0, 300)
  await page.waitForTimeout(600)
  const scrollAfter = await page.evaluate(() => document.querySelector('[class*="drawerScroll"]').scrollTop)
  // The drawer is big enough that a handful of cards fit on one screen; the
  // wheel pager only has something to do once the grid overflows.
  check('滚轮翻页（有溢出时滚动，无溢出则整屏可见）',
    scrollBefore.overflow ? scrollAfter > scrollBefore.top : scrollAfter === scrollBefore.top,
    `overflow=${scrollBefore.overflow} ${scrollBefore.top} → ${Math.round(scrollAfter)}`)

  // The drawer derives its wires from liveEdges, so it can never show more
  // lines than the board actually paints.
  const wireConsistency = await page.evaluate(() => {
    const wires = document.querySelectorAll('svg[class*="drawerWires"] path').length
    const boardLines = [...document.querySelectorAll('.react-flow__edge-path')]
      .filter(path => Number(getComputedStyle(path).opacity) > 0.5).length
    return { wires, boardLines }
  })
  check('抽屉里的连线不超过画布上可见的连线', wireConsistency.wires <= wireConsistency.boardLines,
    JSON.stringify(wireConsistency))

  // Same geometry as the board: a right-angle smoothstep path, no bezier bow.
  const wireShapes = await page.evaluate(() => {
    const paths = [...document.querySelectorAll('svg[class*="drawerWires"] path')]
      .filter(path => (path.getAttribute('stroke-dasharray') ?? '') !== '')
    return {
      count: paths.length,
      curved: paths.filter(path => /[CQ]/.test(path.getAttribute('d') ?? '')).length,
    }
  })
  check('抽屉里的连线是折线（与画布同一算法，不是贝塞尔弯的）',
    wireShapes.curved === 0, JSON.stringify(wireShapes))


  await page.screenshot({ path: path.join(shots, 'probe-drawer.png') })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  check('Esc 收起抽屉', await page.evaluate(() => document.querySelector('[class*="tm_drawer"]:not([class*="Backdrop"])') === null))

  // ---- 4b. finished while the map is up (the reported bug) --------------
  // Uses a card that is on the GRID (deterministic DOM, no drawer involved).
  // The harness never sets completionUnread by itself, so a green light here can
  // only come from the map's own projection — the "opened the map from this
  // conversation" case, where the shell stays quiet.
  const chatId = await page.evaluate(() => {
    const state = window.__harness.state()
    const entry = [...document.querySelectorAll('.react-flow__node')]
      .map(el => ({ id: el.getAttribute('data-id'), r: el.getBoundingClientRect() }))
      .filter(item => state.cards[item.id] !== undefined && item.r.y > 0)
      .sort((a, b) => (a.r.y - b.r.y) || (a.r.x - b.r.x))[0]
    return entry === undefined ? null : state.cards[entry.id].sessionId
  })
  check('找到一个网格上的会话用于测试', chatId !== null, String(chatId))
  await page.evaluate((id) => window.__harness.setRunning(id, true), chatId)
  await page.waitForTimeout(500)
  const runningNow = (await readChips())[chatId]
  check('地图里跑到一半 → 该卡显示正在运行', runningNow?.kind === 'running', JSON.stringify(runningNow))
  await page.evaluate((id) => window.__harness.setRunning(id, false), chatId)
  await page.waitForTimeout(600)
  const finishedNow = (await readChips())[chatId]
  check('跑完 → 自动变「待查看」绿灯（不靠宿主的 unread）',
    finishedNow?.kind === 'done' && finishedNow.text === '待查看' && /52, 199, 89/.test(finishedNow.color ?? ''),
    JSON.stringify(finishedNow))

  // Opening it counts as reading it.
  const chatPoint = await cardPoint(chatId)
  if (chatPoint !== null) await page.mouse.click(chatPoint.x, chatPoint.y - 6)
  await page.waitForTimeout(500)
  const openedChat = await page.evaluate(() => window.__harness.log.filter(e => e.kind === 'ui.openSession').at(-1))
  check('点开该会话', openedChat?.detail === chatId, JSON.stringify(openedChat?.detail))
  await openMap()
  await page.waitForTimeout(600)
  const afterAck = (await readChips())[chatId]
  check('打开过后不再显示待查看', afterAck?.kind !== 'done', JSON.stringify(afterAck))

  // ---- 4c. finished while the map was CLOSED → stay quiet ----------------
  // The mark exists for completions that happen BEHIND the map. If you were
  // watching the conversation itself, you already saw it — no lamp.
  const quietSession = await page.evaluate(() => {
    const state = window.__harness.state()
    const entry = [...document.querySelectorAll('.react-flow__node')]
      .map(el => ({ id: el.getAttribute('data-id'), r: el.getBoundingClientRect() }))
      .filter(item => state.cards[item.id] !== undefined)
      .sort((a, b) => (a.r.y - b.r.y) || (a.r.x - b.r.x))[0]
    return entry === undefined ? null : state.cards[entry.id].sessionId
  })
  await page.evaluate((id) => window.__harness.setRunning(id, true), quietSession)
  await page.waitForTimeout(400)
  await page.click('[class*="tm_backButton"]')
  await page.waitForTimeout(400)
  await page.evaluate((id) => window.__harness.setRunning(id, false), quietSession)
  await page.waitForTimeout(400)
  await openMap()
  await page.waitForTimeout(700)
  const closedFinish = await page.evaluate((id) => {
    const card = document.querySelector('[data-mindmap-session="' + id + '"]')
    const chip = card === null ? null : card.querySelector('[data-mindmap-chip]')
    return chip === null ? null : chip.getAttribute('data-mindmap-chip')
  }, quietSession)
  check('关着地图时跑完 → 不亮「待查看」', closedFinish !== 'done',
    String(quietSession) + ' → ' + String(closedFinish))

  // ---- 4e. read elsewhere → the map's own mark must go away ---------------
  // Finished while the map was up (mark appears), then the user opened it from
  // the desktop notification: the shell reports the completion as read and the
  // 待查看 lamp has to disappear.
  const notifySession = await page.evaluate(() => {
    const state = window.__harness.state()
    const entry = [...document.querySelectorAll('.react-flow__node')]
      .map(el => ({ id: el.getAttribute('data-id'), r: el.getBoundingClientRect() }))
      .filter(item => state.cards[item.id] !== undefined && item.r.width > 10)
      .sort((a, b) => (a.r.y - b.r.y) || (a.r.x - b.r.x))[0]
    return entry === undefined ? null : state.cards[entry.id].sessionId
  })
  if (notifySession !== null) {
    await page.evaluate((id) => window.__harness.setRunning(id, true), notifySession)
    await page.waitForTimeout(450)
    await page.evaluate((id) => window.__harness.setRunning(id, false), notifySession)
    await page.waitForTimeout(450)
    const beforeRead = await page.evaluate((id) => {
      const card = document.querySelector('[data-mindmap-session="' + id + '"]')
      const chip = card === null ? null : card.querySelector('[data-mindmap-chip]')
      return chip === null ? null : chip.getAttribute('data-mindmap-chip')
    }, notifySession)
    check('地图开着时跑完 → 亮起待查看', beforeRead === 'done', String(beforeRead))
    // The shell may report "not unread" simply because it never flagged it (the
    // conversation is still the main view behind the map). The lamp must stay.
    await page.evaluate((id) => window.__harness.hostNotUnread(id), notifySession)
    await page.waitForTimeout(450)
    const afterNotUnread = await page.evaluate((id) => {
      const card = document.querySelector('[data-mindmap-session="' + id + '"]')
      const chip = card === null ? null : card.querySelector('[data-mindmap-chip]')
      return chip === null ? null : chip.getAttribute('data-mindmap-chip')
    }, notifySession)
    check('宿主说“未标记未读”时，被地图挡住的完成仍然亮着',
      afterNotUnread === 'done', String(afterNotUnread))
    // The shell flags it unread, then the notification click marks it read — the
    // true→false transition is what releases our mark.
    await page.evaluate((id) => window.__harness.hostUnread(id), notifySession)
    await page.waitForTimeout(450)
    await page.evaluate((id) => window.__harness.notificationJump(id), notifySession)
    await page.waitForTimeout(600)
    const afterRead = await page.evaluate((id) => {
      const card = document.querySelector('[data-mindmap-session="' + id + '"]')
      const chip = card === null ? null : card.querySelector('[data-mindmap-chip]')
      return chip === null ? null : chip.getAttribute('data-mindmap-chip')
    }, notifySession)
    check('从通知进去看过之后 → 待查看消失', afterRead !== 'done',
      String(notifySession) + ' → ' + String(afterRead))
  } else {
    check('从通知进去看过之后 → 待查看消失', false, '没有可用的卡片')
  }

  // ---- 4d. right-click a card INSIDE the stack drawer --------------------
  await page.click('.react-flow__node[data-id^="stack-"] [class*="stackFace"]')
  await page.waitForTimeout(450)
  const drawerCardPoint = await page.evaluate(() => {
    const card = document.querySelector('[data-stack-card]')
    if (card === null) return null
    const r = card.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + 24) }
  })
  if (drawerCardPoint !== null) {
    await page.mouse.click(drawerCardPoint.x, drawerCardPoint.y, { button: 'right' })
    await page.waitForTimeout(450)
  }
  const drawerMenu = await menuItems()
  check('堆叠抽屉里右键也有卡片菜单',
    drawerMenu.some(text => text.includes('重命名')) && drawerMenu.some(text => text.includes('删除会话')),
    JSON.stringify(drawerMenu))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)

  // ---- 5. panel model --------------------------------------------------
  check('地图是 main 面板（不是遮罩）', (await page.evaluate(() => window.__harness.panelState())).selectedPanel === 'mind-map')
  await page.click('[class*="tm_backButton"]')
  await page.waitForTimeout(400)
  check('返回按钮回到对话', await page.evaluate(() => document.querySelector('[data-harness-placeholder]') !== null))
  await openMap()

  // ---- 5b. the tab you came from stays marked --------------------------
  // The shell persists the open conversation under `dsh.sessions.current`; the
  // map reads it the moment it takes over the centre column.
  // Pick a card that is on the grid right now (folded ones are not in the DOM).
  const markedSession = await page.evaluate(() => {
    const state = window.__harness.state()
    const entry = [...document.querySelectorAll('.react-flow__node')]
      .map(el => ({ id: el.getAttribute('data-id'), r: el.getBoundingClientRect() }))
      .filter(item => state.cards[item.id] !== undefined && item.r.width > 10)
      .sort((a, b) => (a.r.y - b.r.y) || (a.r.x - b.r.x))[0]
    return entry === undefined ? null : state.cards[entry.id].sessionId
  })
  await page.click('[class*="tm_backButton"]')
  await page.waitForTimeout(300)
  await page.evaluate((sessionId) => {
    localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId }))
  }, markedSession)
  await openMap()
  await page.waitForTimeout(600)
  const currentCard = await page.evaluate(() => {
    const marked = [...document.querySelectorAll('[data-mindmap-session]')]
      .filter(node => node.querySelector('[class*="cardReticle"]') !== null)
      .map(node => node.getAttribute('data-mindmap-session'))
    return marked
  })
  check('打开地图前所在的那个对话被标成当前',
    currentCard.includes(markedSession), `${JSON.stringify(currentCard)} vs ${markedSession}`)
  const currentRing = await page.evaluate(() => {
    const node = [...document.querySelectorAll('[data-mindmap-session]')]
      .find(item => item.querySelector('[class*="cardReticle"]') !== null)
    if (node === undefined) return null
    const corners = [...node.querySelectorAll('[class*="cardReticle"] i')]
    const style = corners.length === 0 ? null : getComputedStyle(corners[0])
    const self = getComputedStyle(node)
    return {
      count: corners.length,
      color: style?.borderTopColor ?? null,
      top: style?.borderTopWidth ?? null,
      right: style?.borderRightWidth ?? null,
      bottom: style?.borderBottomWidth ?? null,
      outline: self.outlineStyle + ' ' + self.outlineWidth,
    }
  })
  check('当前卡片用四角瞄镜（不是整圈边框）',
    currentRing?.count === 4 && /255, 255, 255/.test(currentRing?.color ?? '')
      && currentRing?.top === '2px' && currentRing?.right === '0px' && currentRing?.bottom === '0px',
    JSON.stringify(currentRing))
  check('当前卡片不压暗', await page.evaluate(() => {
    const node = [...document.querySelectorAll('[data-mindmap-session]')]
      .find(item => item.querySelector('[class*="cardReticle"]') !== null)
    return node !== undefined && Number(getComputedStyle(node).opacity) === 1
  }))

  // ---- 6. activity promotes -------------------------------------------
  const orderOf = (sessionIds) => page.evaluate((ids) => {
    const state = window.__harness.state()
    return [...document.querySelectorAll('.react-flow__node')]
      .map(el => ({ id: el.getAttribute('data-id'), r: el.getBoundingClientRect() }))
      .filter(entry => ids.includes(entry.id))
      .sort((a, b) => (a.r.y - b.r.y) || (a.r.x - b.r.x))
      .map(entry => state.cards[entry.id]?.sessionId)
  }, sessionIds)
  const beforeTouch = await orderOf(['card-1', 'card-2'])
  await page.evaluate(() => window.__harness.touch('s5'))
  await page.waitForTimeout(700)
  const afterTouch = await orderOf(['card-1', 'card-2', 'card-5'])
  check('活跃会话被提到开头', afterTouch[0] === 's5', `${JSON.stringify(beforeTouch)} → ${JSON.stringify(afterTouch.slice(0, 2))}`)

  // The case that matters in real use: the message arrives while the map is
  // CLOSED (panel unmounted) — the promotion must survive the remount.
  const firstCardSession = () => page.evaluate(() => {
    const state = window.__harness.state()
    const entry = [...document.querySelectorAll('.react-flow__node')]
      .map(el => ({ id: el.getAttribute('data-id'), r: el.getBoundingClientRect() }))
      .filter(item => state.cards[item.id] !== undefined)
      .sort((a, b) => (a.r.y - b.r.y) || (a.r.x - b.r.x))[0]
    return entry === undefined ? null : state.cards[entry.id].sessionId
  })
  await page.click('[class*="tm_backButton"]')
  await page.waitForTimeout(400)
  await page.evaluate(() => window.__harness.touch('s4'))
  await openMap()
  await page.waitForTimeout(600)
  check('关着地图时发的消息，重新打开也会提前', (await firstCardSession()) === 's4', `first=${await firstCardSession()}`)

  // ---- 7. resize: edges + corners -------------------------------------
  const handleAxes = await page.evaluate(() =>
    [...document.querySelectorAll('[data-mindmap-workspace="ws-daily"] [data-mindmap-resize]')]
      .map(el => el.getAttribute('data-mindmap-resize')))
  check('四边四角共 8 个拉伸把手', ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].every(axis => handleAxes.includes(axis)), JSON.stringify(handleAxes))

  const labBefore = (await page.evaluate(() => window.__harness.nodeBoxes().frames))['ws-lab']
  const north = await page.evaluate(() => {
    const r = document.querySelector('[data-mindmap-workspace="ws-lab"] [data-mindmap-resize="n"]').getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  await page.mouse.move(north.x, north.y)
  await page.mouse.down()
  for (let i = 1; i <= 6; i++) await page.mouse.move(north.x, north.y - i * 10)
  await page.mouse.up()
  await page.waitForTimeout(600)
  const labAfterNorth = (await page.evaluate(() => window.__harness.nodeBoxes().frames))['ws-lab']
  check('上边把手改高度并带动上边界', labAfterNorth.h > labBefore.h + 10 && labAfterNorth.y < labBefore.y - 5,
    `${labBefore.y}/${labBefore.h} → ${labAfterNorth.y}/${labAfterNorth.h}`)

  const cornerBefore = (await page.evaluate(() => window.__harness.nodeBoxes().frames))['ws-lab']
  const corner = await page.evaluate(() => {
    const el = document.querySelector('[data-mindmap-workspace="ws-lab"] [data-mindmap-resize="se"]')
    const r = el.getBoundingClientRect()
    const x = r.x + r.width / 2, y = r.y + r.height / 2
    const hit = document.elementFromPoint(x, y)
    return { x, y, hit: hit === null ? 'nothing' : String(hit.className) }
  })
  check('对角把手在指针下可命中', corner.hit.includes('wsFrameResizeSe'), corner.hit)
  await page.mouse.move(corner.x, corner.y)
  await page.waitForTimeout(80)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(corner.x + i * 12, corner.y + i * 16)
    await page.waitForTimeout(16)
  }
  await page.mouse.up()
  await page.waitForTimeout(700)
  const cornerAfter = (await page.evaluate(() => window.__harness.nodeBoxes().frames))['ws-lab']
  check('对角把手同时改宽高', cornerAfter.w > cornerBefore.w + 10 && cornerAfter.h > cornerBefore.h + 10,
    `${cornerBefore.w}x${cornerBefore.h} → ${cornerAfter.w}x${cornerAfter.h}`)
  await page.screenshot({ path: path.join(shots, 'probe-resized.png') })

  // ---- 8. new chat goes to the shell's own page ------------------------
  // Aim at the folder's transparent body: a card would open on the first click
  // now that single-click navigation exists.
  const medkit = (await page.evaluate(() => window.__harness.nodeBoxes().frames))['ws-medkit']
  const panePoint = await page.evaluate((frameBox) => {
    for (let dy = 20; dy < frameBox.h - 8; dy += 6) {
      for (let dx = 20; dx < frameBox.w - 8; dx += 6) {
        const x = frameBox.x + dx, y = frameBox.y + dy
        const hit = document.elementFromPoint(x, y)
        if (hit !== null && hit.classList.contains('react-flow__pane')) return { x, y }
      }
    }
    return null
  }, medkit)
  check('文件夹内有可用于双击的透明区', panePoint !== null, JSON.stringify(panePoint))
  await page.mouse.dblclick(panePoint.x, panePoint.y)
  await page.waitForTimeout(600)
  const started = await page.evaluate(() => window.__harness.log.filter(e => e.kind === 'ui.startSession').at(-1))
  check('双击工作区 = 用系统页面新建该工作区对话', started?.detail?.workspaceId === 'ws-medkit', JSON.stringify(started?.detail))
  check('新建对话后离开地图', (await page.evaluate(() => window.__harness.panelState())).selectedPanel === null)
  check('地图里不再有内嵌草稿面板', await page.evaluate(() => document.querySelector('[class*="tm_draftCard"]') === null))
  await openMap()

// ---- 9. workspace colour — 已移除该功能（工作区保持默认配色）----

  // ---- 10. title bar wins over the top edge handle ---------------------
  const beforeTitleDrag = (await page.evaluate(() => window.__harness.nodeBoxes().frames))['ws-medkit']
  const titleGrab = await page.evaluate(() => {
    const el = document.querySelector('[data-mindmap-workspace="ws-medkit"] [class*="wsFrameLabel"]')
    const r = el.getBoundingClientRect()
    // Lower edge of the chip = inside the frame's top band, where the N handle sits.
    return { x: r.x + r.width / 2, y: r.y + r.height - 2, hit: document.elementFromPoint(r.x + r.width / 2, r.y + r.height - 2)?.className ?? '' }
  })
  check('标题栏压在顶边把手之上', String(titleGrab.hit).includes('wsFrameLabel'), titleGrab.hit)
  await page.mouse.move(titleGrab.x, titleGrab.y)
  await page.mouse.down()
  for (let i = 1; i <= 6; i++) await page.mouse.move(titleGrab.x + i * 8, titleGrab.y + i * 8)
  await page.mouse.up()
  await page.waitForTimeout(600)
  const afterTitleDrag = (await page.evaluate(() => window.__harness.nodeBoxes().frames))['ws-medkit']
  check('拖标题栏移动整个工作区（不改尺寸）',
    Math.abs(afterTitleDrag.w - beforeTitleDrag.w) <= 1 && Math.abs(afterTitleDrag.h - beforeTitleDrag.h) <= 1
      && (Math.abs(afterTitleDrag.x - beforeTitleDrag.x) > 10 || Math.abs(afterTitleDrag.y - beforeTitleDrag.y) > 10),
    `${beforeTitleDrag.x}/${beforeTitleDrag.y} ${beforeTitleDrag.w}x${beforeTitleDrag.h} → ${afterTitleDrag.x}/${afterTitleDrag.y} ${afterTitleDrag.w}x${afterTitleDrag.h}`)

  const frameLabelBox = await box('[data-mindmap-workspace="ws-daily"] [class*="wsFrameLabel"]')
  await page.mouse.click(frameLabelBox.x + 20, frameLabelBox.y + 10, { button: 'right' })
  await page.waitForTimeout(350)
  const wsMenu = await menuItems()
  check('工作区右键菜单含「重命名工作区」', wsMenu.some(text => text.includes('重命名工作区')), JSON.stringify(wsMenu))
  await clickMenuItem('重命名工作区')
  await page.waitForTimeout(350)
  const wsDialog = await page.evaluate(() => {
    const input = document.querySelector('[class*="renameInput"]')
    return input === null ? null : input.value
  })
  check('对话框预填工作区当前名字', wsDialog === '日常任务', String(wsDialog))
  await page.fill('[class*="renameInput"]', '改过的工作区')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(700)
  const wsCall = await page.evaluate(() => window.__harness.log.filter(entry => entry.kind === 'rpc.call').at(-1))
  check('工作区重命名走 workspace/rename',
    wsCall?.detail?.endpoint === 'workspace/rename'
      && wsCall?.detail?.args?.request?.workspaceId === 'ws-daily'
      && wsCall?.detail?.args?.request?.title === '改过的工作区',
    JSON.stringify(wsCall?.detail))
  const wsLabelNow = await page.evaluate(() =>
    document.querySelector('[data-mindmap-workspace="ws-daily"] [class*="wsFrameLabel"]')?.textContent ?? null)
  check('文件夹标题跟着改', (wsLabelNow ?? '').includes('改过的工作区'), String(wsLabelNow))


  // ---- 11. pin / archive / delete / batch -----------------------------
  const pinPoint = await cardPoint('s7')
  await page.mouse.click(pinPoint.x, pinPoint.y, { button: 'right' })
  await page.waitForTimeout(400)
  const cardMenu = await menuItems()
  check('右键菜单含置顶/标为未读/归档/删除/批量',
    ['置顶', '标为未读', '归档', '删除会话', '批量操作'].every(needle => cardMenu.some(text => text.includes(needle))),
    JSON.stringify(cardMenu))
  // 查看摘要：read-only preview of exactly what this card would push.
  // Reading order: 置顶 → 标为未读 → 重命名 → 查看摘要.
  const order = (label) => cardMenu.findIndex(text => text.includes(label))
  check('菜单顺序是 置顶 → 标为未读 → 重命名 → 查看摘要',
    order('置顶') >= 0 && order('置顶') < order('标为未读')
      && order('标为未读') < order('重命名') && order('重命名') < order('查看摘要'),
    JSON.stringify(cardMenu))
  check('卡片菜单里有「查看摘要」', cardMenu.some(text => text.includes('查看摘要')), JSON.stringify(cardMenu))
  const digestRow = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[class*="menuItem"]')]
    const row = rows.find(node => node.textContent.includes('查看摘要'))
    if (row === undefined) return null
    const box = row.getBoundingClientRect()
    return { x: Math.round(box.x + 30), y: Math.round(box.y + box.height / 2), disabled: row.getAttribute('aria-disabled') === 'true' }
  })
  if (digestRow !== null && digestRow.disabled === false) {
    await page.mouse.click(digestRow.x, digestRow.y)
    await page.waitForTimeout(500)
    const digestDialog = await page.evaluate(() => {
      const dialog = document.querySelector('[data-mindmap-digest-dialog]')
      if (dialog === null) return null
      const areas = [...dialog.querySelectorAll('textarea')].map(node => node.value)
      return { areas: areas.length, hasRecall: areas.some(text => text.includes('提醒')), sample: (areas[0] ?? '').slice(0, 50) }
    })
    check('「查看摘要」是只读预览，并带上“去看完整对话”的提醒',
      digestDialog !== null && digestDialog.areas >= 1 && digestDialog.hasRecall === true,
      JSON.stringify(digestDialog))
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    // The following checks read the menu rows: open it again.
    await page.mouse.click(pinPoint.x, pinPoint.y, { button: 'right' })
    await page.waitForTimeout(400)
  } else {
    check('「查看摘要」是只读预览，并带上“去看完整对话”的提醒', false, 'menu row missing/disabled')
  }
  const menuDecor = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[class*="menuItem"]')]
    const danger = rows.find(node => node.textContent.includes('删除'))
    return {
      total: rows.length,
      withIcon: rows.filter(node => node.querySelector('svg') !== null).length,
      dangerColor: danger === null ? null : getComputedStyle(danger).color,
      dangerText: danger === null ? null : danger.textContent.trim(),
    }
  })
  check('菜单每一项前面都有图标',
    menuDecor.total >= 5 && menuDecor.withIcon === menuDecor.total, JSON.stringify(menuDecor))
  // capture with the menu open, for eyeballing the glyphs
  await page.screenshot({ path: path.join(shots, 'probe-menu.png') })
  check('「删除」那一项是红字',
    /242, 78, 78/.test(menuDecor.dangerColor ?? ''), JSON.stringify(menuDecor))

  check('右键菜单不再有「打开对话」「从地图移除」',
    !cardMenu.some(text => text.includes('打开对话') || text.includes('从地图移除')),
    JSON.stringify(cardMenu))
  await clickMenuItem('置顶')
  const pinLog = await page.evaluate(() => window.__harness.log.filter(e => e.kind === 'ui.pinSession').at(-1))
  const pinnedNow = await page.evaluate(() => window.__harness.pinned())
  check('置顶调用原生 pinSession', pinLog?.detail === 's7', JSON.stringify(pinLog?.detail))
  check('置顶状态与侧栏同源', pinnedNow.includes('s7'), JSON.stringify(pinnedNow))
  await page.waitForTimeout(500)
  const medkitOrder = await page.evaluate(() => {
    const state = window.__harness.state()
    return [...document.querySelectorAll('.react-flow__node')]
      .map(el => ({ id: el.getAttribute('data-id'), r: el.getBoundingClientRect() }))
      .filter(entry => ['card-6', 'card-7'].includes(entry.id))
      .sort((a, b) => (a.r.y - b.r.y) || (a.r.x - b.r.x))
      .map(entry => state.cards[entry.id]?.sessionId)
  })
  check('置顶后卡片排到最前', medkitOrder[0] === 's7', JSON.stringify(medkitOrder))
  const pinnedCard = await page.evaluate(() => {
    const card = document.querySelector('[data-mindmap-session="s7"]')
    if (card === null) return null
    const mark = card.querySelector('[data-mindmap-pin]')
    const style = mark === null ? null : getComputedStyle(mark)
    return {
      pin: mark !== null,
      color: style?.color ?? null,
      glow: style?.filter ?? null,
      opacity: Number(getComputedStyle(card).opacity),
    }
  })
  check('置顶卡片带置顶图标（发光）',
    pinnedCard?.pin === true
      && /255, 214, 106/.test(pinnedCard?.color ?? '')
      && (pinnedCard?.glow ?? '').includes('drop-shadow'),
    JSON.stringify(pinnedCard))
  check('置顶卡片不压暗', pinnedCard?.opacity === 1, JSON.stringify(pinnedCard))

  // ---- 重命名 -----------------------------------------------------------
  const renamePoint = await cardPoint('s7')
  await page.mouse.click(renamePoint.x, renamePoint.y, { button: 'right' })
  await page.waitForTimeout(350)
  const hasRename = (await menuItems()).some(text => text.includes('重命名'))
  check('右键菜单含「重命名」', hasRename, JSON.stringify(await menuItems()))
  await clickMenuItem('重命名')
  await page.waitForTimeout(350)
  const renameDialog = await page.evaluate(() => {
    const input = document.querySelector('[class*="renameInput"]')
    return input === null ? null : { value: input.value }
  })
  check('弹出重命名对话框并预填当前标题',
    renameDialog !== null && renameDialog.value !== '' && renameDialog.value !== 's7',
    JSON.stringify(renameDialog))
  await page.fill('[class*="renameInput"]', '改过的标题')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(700)
  const renameCall = await page.evaluate(() => window.__harness.log.filter(entry => entry.kind === 'rpc.call').at(-1))
  check('重命名走 sessionController 的 rename RPC',
    renameCall?.detail?.endpoint === 'session/rename' && renameCall?.detail?.args?.request?.sessionId === 's7' && renameCall?.detail?.args?.request?.title === '改过的标题',
    JSON.stringify(renameCall?.detail))
  const renamedTitle = await page.evaluate(() => {
    const node = document.querySelector('[data-mindmap-session="s7"] [class*="cardTitle"]')
    return node === null ? null : node.textContent
  })
  check('卡片标题跟着改名', renamedTitle === '改过的标题', String(renamedTitle))

  const beforeArchive = await page.evaluate(() => document.querySelectorAll('.react-flow__node[data-id^="card-"]').length)
  const archivePoint = await cardPoint('s10')
  await page.mouse.click(archivePoint.x, archivePoint.y, { button: 'right' })
  await page.waitForTimeout(400)
  await clickMenuItem('归档')
  const archiveLog = await page.evaluate(() => window.__harness.log.filter(e => e.kind === 'ui.archiveSession').at(-1))
  const afterArchive = await page.evaluate(() => document.querySelectorAll('.react-flow__node[data-id^="card-"]').length)
  check('右键归档调用 archiveSession 并移出地图',
    archiveLog?.detail?.sessionId === 's10' && afterArchive === beforeArchive - 1,
    `${JSON.stringify(archiveLog?.detail)} / ${beforeArchive} → ${afterArchive}`)

  const deletePoint = await cardPoint('s9')
  await page.mouse.click(deletePoint.x, deletePoint.y, { button: 'right' })
  await page.waitForTimeout(400)
  await clickMenuItem('删除会话')
  const trashCall = await page.evaluate(() => window.__harness.recycleCalls().at(-1))
  check('删除走 dsh-recycle-bin 的 trash 接口', trashCall?.action === 'trash' && trashCall?.sessionId === 's9', JSON.stringify(trashCall))


  // Batch mode: every card wears a tick box, and picking one ticks it.
  const batchPoint = await cardPoint('s6')
  await page.mouse.click(batchPoint.x, batchPoint.y, { button: 'right' })
  await page.waitForTimeout(400)
  await clickMenuItem('批量操作')
  const boxes = await page.evaluate(() => ({
    bar: document.querySelector('[class*="tm_batchBar"]') !== null,
    total: document.querySelectorAll('[data-mindmap-pick]').length,
    checked: document.querySelectorAll('[data-mindmap-pick][aria-checked="true"]').length,
  }))
  check('批量模式每张卡右上角都有勾选框', boxes.bar && boxes.total >= 4, JSON.stringify(boxes))
  check('进入批量时第一张已勾选', boxes.checked === 1, `checked=${boxes.checked}`)
  const second = await cardPoint('s7')
  await page.mouse.click(second.x, second.y - 6)
  await page.waitForTimeout(400)
  const batchAfterPick = await page.evaluate(() => ({
    count: document.querySelector('[class*="tm_batchCount"]')?.textContent ?? '',
    checked: document.querySelectorAll('[data-mindmap-pick][aria-checked="true"]').length,
  }))
  check('再点一张 → 勾选框变勾 + 计数 2', /2/.test(batchAfterPick.count) && batchAfterPick.checked === 2, JSON.stringify(batchAfterPick))

  await page.evaluate(() => {
    const target = [...document.querySelectorAll('[class*="tm_batchAction"]')].find(el => el.textContent.trim() === '删除')
    target?.click()
  })
  await page.waitForTimeout(800)
  const batchCall = await page.evaluate(() => window.__harness.recycleCalls().at(-1))
  check('批量删除一次提交 trashMany', batchCall?.action === 'trashMany' && (batchCall?.sessionIds?.length ?? 0) === 2, JSON.stringify(batchCall))
  check('批量删除后退出批量模式', await page.evaluate(() => document.querySelector('[class*="tm_batchBar"]') === null))

  // ---- 11b. the stack drawer survives jumping into a conversation --------
  // Open the daily drawer, jump into one of its conversations, then come back.
  // The panel unmounts on the way out, so this only works because the drawer
  // remembers which folder it was on.
  const drawerOpenClick = await page.evaluate(() => {
    const face = document.querySelector('.react-flow__node[data-id="stack-ws-daily"] [class*="stackFace"]')
    if (face === null) return false
    face.click()
    return true
  })
  await page.waitForTimeout(600)
  const drawerBefore = await page.evaluate(() => {
    const head = document.querySelector('[class*="drawerTitle"]')
    return {
      open: document.querySelector('[class*="drawerBackdrop"]') !== null,
      title: head === null ? null : head.textContent.trim(),
      rows: document.querySelectorAll('[data-stack-card]').length,
    }
  })
  check('堆叠抽屉可以打开', drawerOpenClick === true && drawerBefore.open === true, JSON.stringify(drawerBefore))
  const drawerMotion = await page.evaluate(() => {
    const panel = document.querySelector('[class~="tm_drawer"]')
    const backdrop = document.querySelector('[class~="tm_drawerBackdrop"]')
    if (panel === null || backdrop === null) return null
    const style = getComputedStyle(panel)
    return { panelAnimation: style.animationName, panelDuration: style.animationDuration, backdropAnimation: getComputedStyle(backdrop).animationName }
  })
  check('抽屉弹出有过渡动画',
    drawerMotion !== null && drawerMotion.panelAnimation !== 'none', JSON.stringify(drawerMotion))
  await page.evaluate(() => {
    const row = document.querySelector('[data-stack-card]')
    if (row !== null) { const r = row.getBoundingClientRect(); window.__rowPoint = { x: Math.round(r.x + 60), y: Math.round(r.y + 30) } }
  })
  const rowPoint = await page.evaluate(() => window.__rowPoint ?? null)
  if (rowPoint !== null) await page.mouse.click(rowPoint.x, rowPoint.y)
  const leftMap = await page.evaluate(() => document.querySelector('[class*="tm_panel"]') === null)
  check('从抽屉点卡片会跳进对话', leftMap === true, String(leftMap))
  await page.evaluate(() => {
  })
  await openMap()
  await page.waitForTimeout(1000)
  const drawerAfter = await page.evaluate(() => {
    const head = document.querySelector('[class*="drawerTitle"]')
    return {
      open: document.querySelector('[class*="drawerBackdrop"]') !== null,
      mapOpen: document.querySelector('[class*="tm_panel"]') !== null,
      sideButton: document.querySelector('[class*="tm_sideButton"]') !== null,
      title: head === null ? null : head.textContent.trim(),
      rows: document.querySelectorAll('[data-stack-card]').length,
    }
  })
  const storedDrawer = await page.evaluate(() => ({
    stored: localStorage.getItem('dsh.mind-map.drawer.v1'),
    scroll: localStorage.getItem('dsh.mind-map.drawer-scroll.v1'),
  }))
  console.log('   drawer storage:', JSON.stringify(storedDrawer))
  check('回到地图时抽屉还开着（保留打开进度）',
    drawerAfter.open === true && drawerAfter.title === drawerBefore.title,
    JSON.stringify({ before: drawerBefore, after: drawerAfter }))
  check('抽屉里的内容也没丢', drawerAfter.rows === drawerBefore.rows,
    String(drawerBefore.rows) + ' → ' + String(drawerAfter.rows))
  // Connections between cards of this folder are spelled out inside the drawer.
  const drawerLinks = await page.evaluate(() => ({
    chips: document.querySelectorAll('[data-mindmap-card-links] [data-mindmap-link]').length,
    text: [...document.querySelectorAll('[data-mindmap-card-links] [data-mindmap-link]')].map(n => n.textContent.trim()),
  }))
  check('抽屉里显示同一文件夹内卡片之间的连线',
    drawerLinks.chips >= 1, JSON.stringify(drawerLinks))

  // Drag the second card onto the first: the order must change and stay.
  const beforeOrder = await page.evaluate(() =>
    [...document.querySelectorAll('[data-stack-card]')].map(n => n.getAttribute('data-mindmap-session')))
  // Drive the drag in steps: React has to commit the dragstart state before
  // the dragover handler will accept a drop.
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-stack-card]')]
    if (cards.length < 2) return
    window.__dragData = new DataTransfer()
    cards[1].dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.__dragData }))
  })
  await page.waitForTimeout(350)
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-stack-card]')]
    if (cards.length < 2) return
    const box = cards[0].getBoundingClientRect()
    cards[0].dispatchEvent(new DragEvent('dragover', {
      bubbles: true, cancelable: true, dataTransfer: window.__dragData,
      clientX: box.x + box.width / 2, clientY: box.y + box.height / 2,
    }))
  })
  await page.waitForTimeout(350)
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-stack-card]')]
    if (cards.length < 2) return
    const box = cards[0].getBoundingClientRect()
    cards[0].dispatchEvent(new DragEvent('drop', {
      bubbles: true, cancelable: true, dataTransfer: window.__dragData,
      clientX: box.x + box.width / 2, clientY: box.y + box.height / 2,
    }))
  })
  await page.waitForTimeout(900)
  const afterOrder = await page.evaluate(() =>
    [...document.querySelectorAll('[data-stack-card]')].map(n => n.getAttribute('data-mindmap-session')))
  check('抽屉里拖动卡片可以改变排序并保留',
    beforeOrder.length >= 2 && beforeOrder.join() !== afterOrder.join(),
    JSON.stringify({ before: beforeOrder, after: afterOrder }))
  // The row we just came back from is the map's current conversation: the
  // drawer marks it with the same corner brackets the grid card wears.
  const drawerCurrent = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-stack-card]')]
    return {
      rows: rows.length,
      reticle: rows.filter(node => node.querySelector('[class*="cardReticle"]') !== null).length,
    }
  })
  check('堆叠抽屉里也标出当前对话（选中样式）',
    drawerCurrent.reticle >= 1, JSON.stringify(drawerCurrent))

  // ---- 11c. drawer search: titles + full conversation content ------------
  const searchBoxPoint = await page.evaluate(() => {
    const input = document.querySelector('[data-mindmap-drawer-search]')
    if (input === null) return null
    const r = input.getBoundingClientRect()
    return { x: Math.round(r.x + 30), y: Math.round(r.y + r.height / 2) }
  })
  check('抽屉里有搜索框', searchBoxPoint !== null, JSON.stringify(searchBoxPoint))

  // The search is LOCAL now: it filters the rows this folder is rendering.
  const routeCallsBeforeSearch = await page.evaluate(() => window.__harness.searchRouteCalls().length)
  await page.fill('[data-mindmap-drawer-search]', '清理')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  const localHits = await page.evaluate(() => ({
    hits: document.querySelectorAll('[data-mindmap-search-hit]').length,
    text: document.querySelector('[data-mindmap-search-hit]')?.textContent ?? null,
    marks: document.querySelectorAll('[data-mindmap-search-hit] mark').length,
    routeCalls: window.__harness.searchRouteCalls().length,
  }))
  check('抽屉搜索命中卡片正文（不查宿主语料）',
    localHits.hits >= 1 && (localHits.text ?? '').includes('清理')
      && localHits.routeCalls === routeCallsBeforeSearch,
    JSON.stringify(localHits))
  check('命中处有高亮', localHits.marks >= 1, JSON.stringify(localHits))

  // Header search: same idea, over the cards on the board.
  await page.fill('[data-mindmap-global-search]', '网格')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(600)
  const globalLocal = await page.evaluate(() => ({
    panel: document.querySelector('[class*="globalSearchPanel"]') !== null,
    hits: document.querySelectorAll('[data-mindmap-search-hit]').length,
    marks: document.querySelectorAll('[data-mindmap-search-hit] mark').length,
    routeCalls: window.__harness.searchRouteCalls().length,
  }))
  check('顶栏搜索也只在地图上的卡片里找',
    globalLocal.panel === true && globalLocal.hits >= 1
      && globalLocal.routeCalls === routeCallsBeforeSearch,
    JSON.stringify(globalLocal))
  check('顶栏搜索结果同样高亮', globalLocal.marks >= 1, JSON.stringify(globalLocal))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await page.evaluate(() => {
    const backdrop = document.querySelector('[class*="drawerBackdrop"]')
    if (backdrop !== null) backdrop.click()
  })
  await page.waitForTimeout(300)


  // ---- 11b. 标为未读 ---------------------------------------------------
  const unreadPoint = await page.evaluate(() => {
    const state = window.__harness.state()
    const entry = [...document.querySelectorAll('.react-flow__node')]
      .map(el => ({ id: el.getAttribute('data-id'), r: el.getBoundingClientRect() }))
      .filter(item => state.cards[item.id] !== undefined && item.r.width > 10)
      .sort((a, b) => (a.r.y - b.r.y) || (a.r.x - b.r.x))[0]
    return entry === undefined
      ? null
      : { sessionId: state.cards[entry.id].sessionId, x: entry.r.x + 40, y: entry.r.y + 12 }
  })
  await page.mouse.click(unreadPoint.x, unreadPoint.y, { button: 'right' })
  await page.waitForTimeout(350)
  await clickMenuItem('标为未读')
  await page.waitForTimeout(600)
  const markedUnread = await page.evaluate((sessionId) => {
    const chip = document.querySelector('[data-mindmap-session="' + sessionId + '"] [data-mindmap-chip]')
    return chip === null ? null : { kind: chip.getAttribute('data-mindmap-chip'), text: chip.textContent.trim() }
  }, unreadPoint.sessionId)
  check('右键「标为未读」→ 卡片变成待查看（绿）',
    markedUnread?.kind === 'done' && markedUnread.text === '待查看',
    `${JSON.stringify(markedUnread)} for ${unreadPoint.sessionId}`)

  // ---- 12. single click opens the conversation ------------------------
  // Click whatever card is currently first on the board — by this point the
  // mutations above have removed several of the fixtures.
  const clickTarget = await page.evaluate(() => {
    const state = window.__harness.state()
    const entry = [...document.querySelectorAll('.react-flow__node')]
      .map(el => ({ id: el.getAttribute('data-id'), r: el.getBoundingClientRect() }))
      .filter(item => state.cards[item.id] !== undefined)
      .sort((a, b) => (a.r.y - b.r.y) || (a.r.x - b.r.x))[0]
    return { sessionId: state.cards[entry.id].sessionId, x: entry.r.x + 40, y: entry.r.y + 14 }
  })
  await page.mouse.click(clickTarget.x, clickTarget.y - 6)
  await page.waitForTimeout(600)
  const opened = await page.evaluate(() => window.__harness.log.filter(e => e.kind === 'ui.openSession').at(-1))
  check('左键单击卡片即跳转对话', opened?.detail === clickTarget.sessionId, `${JSON.stringify(opened?.detail)} vs ${clickTarget.sessionId}`)
  check('跳转后离开地图', (await page.evaluate(() => window.__harness.panelState())).selectedPanel === null)

  // ---- 7b. folders are solid: no overlap, by resize or by drag -----------
  // The previous step navigated into a conversation, so the map is closed here.
  await openMap()
  await page.waitForTimeout(700)
  const framesNow = await page.evaluate(() => window.__harness.nodeBoxes().frames)
  const dailyBefore = framesNow['ws-daily']
  const medkitBefore = framesNow['ws-medkit']
  const eastHandle = await box('[data-mindmap-workspace="ws-daily"] [data-mindmap-resize="e"]')
  await page.mouse.move(eastHandle.x + eastHandle.w / 2, eastHandle.y + eastHandle.h / 2)
  await page.mouse.down()
  await page.mouse.move(eastHandle.x + 600, eastHandle.y + eastHandle.h / 2, { steps: 14 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  const dailyAfterPush = (await page.evaluate(() => window.__harness.nodeBoxes().frames))['ws-daily']
  check('拉伸撞到相邻文件夹就停住（不会压过去）',
    dailyAfterPush.x + dailyAfterPush.w <= medkitBefore.x + 1,
    `右边缘 ${Math.round(dailyAfterPush.x + dailyAfterPush.w)} vs 邻居左边 ${Math.round(medkitBefore.x)}（原宽 ${Math.round(dailyBefore.w)}）`)

  const framesBeforeDrop = await page.evaluate(() => window.__harness.nodeBoxes().frames)
  const frameLabel2 = await box('[data-mindmap-workspace="ws-medkit"] [class*="wsFrameLabel"]')
  const dropTarget = {
    x: framesBeforeDrop['ws-daily'].x + framesBeforeDrop['ws-daily'].w / 2,
    y: framesBeforeDrop['ws-daily'].y + framesBeforeDrop['ws-daily'].h / 2,
  }
  await page.mouse.move(frameLabel2.x + 18, frameLabel2.y + 10)
  await page.mouse.down()
  await page.mouse.move(dropTarget.x, dropTarget.y, { steps: 16 })
  await page.waitForTimeout(200)
  const blockedOutline = await page.evaluate(() => {
    const node = document.querySelector('[data-mindmap-workspace="ws-medkit"]')
    return node === null ? null : node.className.includes('wsFrameBlocked')
  })
  await page.mouse.up()
  await page.waitForTimeout(700)
  check('拖到别的文件夹上方时给出红色提示', blockedOutline === true, String(blockedOutline))
  const framesAfterDrop = await page.evaluate(() => window.__harness.nodeBoxes().frames)
  const shiftOf = id => Math.abs(framesAfterDrop[id].x - framesBeforeDrop[id].x)
    + Math.abs(framesAfterDrop[id].y - framesBeforeDrop[id].y)
  check('重叠着松手 → 被拖的退回原位，对方一动不动',
    shiftOf('ws-medkit') <= 2 && shiftOf('ws-daily') <= 2,
    `medkit 位移 ${Math.round(shiftOf('ws-medkit'))}px / daily 位移 ${Math.round(shiftOf('ws-daily'))}px`)
  const overlapAfterDrop = await page.evaluate(() => {
    const frames = Object.entries(window.__harness.nodeBoxes().frames).map(([id, rect]) => ({ id, ...rect }))
    for (let i = 0; i < frames.length; i += 1) {
      for (let j = i + 1; j < frames.length; j += 1) {
        const a = frames[i]
        const b = frames[j]
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        if (ox > 2 && oy > 2) return [a.id, b.id]
      }
    }
    return null
  })
  check('松手之后任何两个文件夹都不重叠', overlapAfterDrop === null, JSON.stringify(overlapAfterDrop))

  // A legal drop still sticks: drag a folder into empty space.
  const framesBeforeFree = await page.evaluate(() => window.__harness.nodeBoxes().frames)
  const freeLabel = await box('[data-mindmap-workspace="ws-medkit"] [class*="wsFrameLabel"]')
  await page.mouse.move(freeLabel.x + 18, freeLabel.y + 10)
  await page.mouse.down()
  await page.mouse.move(freeLabel.x + 40, freeLabel.y + 200, { steps: 14 })
  await page.mouse.up()
  await page.waitForTimeout(700)
  const framesAfterFree = await page.evaluate(() => window.__harness.nodeBoxes().frames)
  const freeShift = Math.abs(framesAfterFree['ws-medkit'].x - framesBeforeFree['ws-medkit'].x)
    + Math.abs(framesAfterFree['ws-medkit'].y - framesBeforeFree['ws-medkit'].y)
  check('拖到空地 → 正常停在原地（不是一律拒绝）', freeShift > 60, `${Math.round(freeShift)}px`)

  // ---- 7c. a neighbour yields MID-DRAG, before the mouse is released ------
  const slotPair = await page.evaluate(() => {
    const state = window.__harness.state()
    return [...document.querySelectorAll('.react-flow__node')]
      .map((node) => {
        const card = state.cards[node.getAttribute('data-id')]
        if (card === undefined) return null
        const r = node.getBoundingClientRect()
        return {
          cardId: node.getAttribute('data-id'),
          sessionId: card.sessionId,
          x: Math.round(r.x),
          y: Math.round(r.y),
        }
      })
      .filter(entry => entry !== null)
      .sort((a, b) => (a.y - b.y) || (a.x - b.x))
      .slice(0, 2)
  })
  const firstCard = slotPair[0]
  const secondCard = slotPair[1]
  const cardGrab = await page.evaluate((cardId) => {
    const node = document.querySelector(`[data-id="${cardId}"]`)
    const r = node.getBoundingClientRect()
    return { x: Math.round(r.x + 50), y: Math.round(r.y + 14) }
  }, firstCard.cardId)
  await page.mouse.move(cardGrab.x, cardGrab.y)
  await page.mouse.down()
  await page.mouse.move(secondCard.x + 40, cardGrab.y, { steps: 10 })
  await page.waitForTimeout(320)
  const neighbourMidDrag = await page.evaluate((sid) => {
    const state = window.__harness.state()
    const node = [...document.querySelectorAll('.react-flow__node')]
      .find(el => state.cards[el.getAttribute('data-id')]?.sessionId === sid)
    return node === undefined ? null : Math.round(node.getBoundingClientRect().x)
  }, secondCard.sessionId)
  await page.mouse.up()
  await page.waitForTimeout(500)
  check('拖到邻居身上时，邻居在松手前就让位',
    neighbourMidDrag !== null && Math.abs(neighbourMidDrag - firstCard.x) <= 8,
    `邻居 x: ${secondCard.x} → ${neighbourMidDrag}（被拖卡片原位 ${firstCard.x}）`)

  // ---- 14. state survives a restart -----------------------------------

  // ---- 13b. connection → new conversation (spawn) -----------------------
  // Drag from a card's right handle onto empty canvas: the fork panel opens,
  // "新对话" creates a session through session/create and prompts it. This is
  // the flow that used to fail with "界面服务还在初始化".
  // Pick a card that is actually rendered (some may be folded into a stack cell).
  const spawnCardId = await page.evaluate(() => {
    const handle = document.querySelector('.react-flow__node .react-flow__handle-right')
    if (handle === null) return null
    const node = handle.closest('.react-flow__node')
    return node === null ? null : node.getAttribute('data-id')
  })
  if (spawnCardId !== null) {
    const handlePoint = await page.evaluate((cardId) => {
      const node = document.querySelector('[data-id="' + cardId + '"]')
      const handle = node === null ? null : node.querySelector('.react-flow__handle-right')
      if (handle === null) return null
      const r = handle.getBoundingClientRect()
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    }, spawnCardId)
    if (handlePoint !== null) {
      await page.mouse.move(handlePoint.x, handlePoint.y)
      await page.mouse.down()
      await page.mouse.move(handlePoint.x + 160, handlePoint.y + 220, { steps: 12 })
      await page.mouse.up()
      await page.waitForTimeout(600)
    }
  }
  const spawnPanel = await box('[class*="spawnPanel"]')
  check('从卡片连线拖到空白处弹出新建面板', spawnPanel !== null, JSON.stringify(spawnPanel))
  if (spawnPanel !== null) {
    await page.click('[class*="spawnModes"] button:first-of-type')
    await page.waitForTimeout(250)
    await page.fill('[class*="spawnPanel"] textarea', '这条对话是连线新建的')
    await page.waitForTimeout(200)
    const spawnModes = await page.evaluate(() =>
      [...document.querySelectorAll('[class*="spawnModes"] button')].map(node => node.textContent.trim()))
    check('只剩「摘要注入 / 完整对话」两种模式（不继承已删除）',
      spawnModes.length === 2 && spawnModes.includes('完整对话'), JSON.stringify(spawnModes))
    const spawnHasButton = await page.evaluate(() =>
      document.querySelectorAll('[class*="spawnBtnPrimary"]').length > 0)
    check('新建面板有首条消息输入框和确认按钮', spawnHasButton === true, String(spawnHasButton))
    await page.click('[class*="spawnBtnPrimary"]')
    await page.waitForTimeout(1400)
    const spawnCalls = await page.evaluate(() => ({
      create: window.__harness.log.filter(entry => entry.kind === 'rpc.create').at(-1) ?? null,
      prompt: window.__harness.log.filter(entry => entry.kind === 'rpc.prompt').at(-1) ?? null,
      error: document.querySelector('[class*="spawnError"]')?.textContent ?? null,
      modes: [...document.querySelectorAll('[class*="spawnModes"] button')].map(node => node.textContent.trim()),
    }))
    check('走 session/create 建会话（不是那个不存在的 api）',
      spawnCalls.create !== null, JSON.stringify(spawnCalls.create))
    check('面板不再报「界面服务还在初始化」',
      (spawnCalls.error ?? '').includes('初始化') === false, String(spawnCalls.error))

  }

  // s4 finishes (green), s5 is still running when we "quit", s11 fails (red).
  // All three live in localStorage, so a reload must bring them back — the
  // harness rebuilds its status map from scratch, exactly like a restart.
  // The panel must be UP for these transitions to be observed at all.
  if ((await page.evaluate(() => window.__harness.panelState())).selectedPanel !== 'mind-map') await openMap()
  await page.waitForTimeout(400)
  await page.evaluate(() => window.__harness.setRunning('s4', true))
  await page.waitForTimeout(300)
  await page.evaluate(() => window.__harness.setRunning('s4', false))
  await page.evaluate(() => window.__harness.setRunning('s5', true))
  await page.evaluate(() => window.__harness.raiseError('s3'))
  await page.waitForTimeout(800)
  const preReloadBadge = await page.evaluate(() => { const chip = document.querySelector('[data-mindmap-session="s4"] [data-mindmap-chip]'); return chip === null ? null : chip.getAttribute('data-mindmap-chip') })
  check('重启前 s4 已是待读', preReloadBadge === 'done', String(preReloadBadge))
  await page.evaluate(() => window.dispatchEvent(new Event('beforeunload')))
  await page.reload()
  await page.waitForTimeout(1800)
  if ((await page.evaluate(() => window.__harness.panelState())).selectedPanel !== 'mind-map') await openMap()
  await page.click('.react-flow__node[data-id^="stack-"] [class*="stackFace"]')
  await page.waitForTimeout(500)
  // The drawer restores its last search; clear it so every card is listed.
  await page.evaluate(() => {
    const input = document.querySelector('[data-mindmap-drawer-search]')
    if (input === null) return
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    if (setter !== undefined) setter.call(input, '')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.waitForTimeout(400)
  const restored = await page.evaluate(() => {
    const out = { chips: {}, interrupted: [], draft: [] }
    for (const root of document.querySelectorAll('[data-mindmap-session]')) {
      const sessionId = root.getAttribute('data-mindmap-session')
      const chip = root.querySelector('[data-mindmap-chip]')
      if (chip !== null) out.chips[sessionId] = chip.getAttribute('data-mindmap-chip')
      if (root.querySelector('[data-mindmap-interrupted]') !== null) out.interrupted.push(sessionId)
      if (root.querySelector('[data-mindmap-draft]') !== null) out.draft.push(sessionId)
    }
    return out
  })
  check('重启后「已完成待读」还在', restored.chips.s4 === 'done', JSON.stringify(restored.chips))
  check('重启后「异常终止」还在', restored.chips.s3 === 'error', JSON.stringify(restored.chips))
  check('重启后「已中断」还在', restored.interrupted.includes('s5'), JSON.stringify(restored.interrupted))
  await page.screenshot({ path: path.join(shots, 'probe-after-restart.png') })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // ---- 7d. the drop must KEEP the yield it previewed ---------------------
  const orderBefore = await page.evaluate(() => window.__harness.state().cards)
  const pair = await page.evaluate(() => {
    const state = window.__harness.state()
    return [...document.querySelectorAll('.react-flow__node')]
      .map((node) => {
        const card = state.cards[node.getAttribute('data-id')]
        if (card === undefined) return null
        const r = node.getBoundingClientRect()
        return { cardId: node.getAttribute('data-id'), sessionId: card.sessionId, x: Math.round(r.x), y: Math.round(r.y) }
      })
      .filter(entry => entry !== null)
      .sort((a, b) => (a.y - b.y) || (a.x - b.x))
      .slice(0, 2)
  })
  const readingBefore = await page.evaluate(() => {
    const state = window.__harness.state()
    return Object.entries(state.cards)
      .map(([id, card]) => ({ id, x: card.x, y: card.y }))
      .sort((a, b) => (a.y - b.y) || (a.x - b.x))
      .map(entry => entry.id)
  })
  if (pair.length === 2) {
    const [first, second] = pair
    const grab = await page.evaluate((cardId) => {
      const node = document.querySelector(`[data-id="${cardId}"]`)
      const r = node.getBoundingClientRect()
      return { x: Math.round(r.x + 50), y: Math.round(r.y + 14) }
    }, first.cardId)
    await page.mouse.move(grab.x, grab.y)
    await page.mouse.down()
    await page.mouse.move(second.x + 40, grab.y, { steps: 10 })
    await page.waitForTimeout(280)
    await page.mouse.up()
    await page.waitForTimeout(700)
    await page.evaluate((cardId) => {
      const node = document.querySelector(`[data-id="${cardId}"]`)
      const r = node.getBoundingClientRect()
      return { x: Math.round(r.x), y: Math.round(r.y) }
    }, first.cardId)
    const readingAfter = await page.evaluate(() => {
      const state = window.__harness.state()
      return Object.entries(state.cards)
        .map(([id, card]) => ({ id, x: card.x, y: card.y }))
        .sort((a, b) => (a.y - b.y) || (a.x - b.x))
        .map(entry => entry.id)
    })
    const indexBefore = readingBefore.indexOf(first.cardId)
    const indexAfter = readingAfter.indexOf(first.cardId)
    check('松手后保留让位结果（不再弹回原位）', indexAfter > indexBefore,
      `${first.sessionId}: 第 ${indexBefore + 1} → 第 ${indexAfter + 1}`)
  } else {
    check('松手后保留让位结果（不再弹回原位）', false, '没有两张可拖的卡片')
  }

  // A session that still has work must be stopped, then moved — not refused.
  if ((await page.evaluate(() => window.__harness.panelState())).selectedPanel !== 'mind-map') await openMap()
  await page.waitForTimeout(600)
  await page.evaluate(() => window.__harness.recycleBusy(true, 1))
  // Pick whichever card is on the board right now (this runs after a reload).
  const busySessionId = await page.evaluate(() => {
    const node = document.querySelector('[data-mindmap-session]')
    return node === null ? null : node.getAttribute('data-mindmap-session')
  })
  const busyPoint = busySessionId === null ? null : await cardPoint(busySessionId)
  if (busyPoint === null) {
    check('会话还在跑时删除：先停止工作再重试删除', false, 'no card on the board')
  } else {
  await page.mouse.click(busyPoint.x, busyPoint.y, { button: 'right' })
  await page.waitForTimeout(400)
  await clickMenuItem('删除会话')
  await page.waitForTimeout(3000)
  const busyDelete = await page.evaluate((sid) => ({
    stopCalls: window.__harness.log.filter(entry => entry.kind === 'ui.archiveSession' && entry.detail?.options?.stopActivity === true).length,
    recycleCalls: window.__harness.recycleCalls().length,
    stillThere: [...document.querySelectorAll('[data-mindmap-session]')].some(node => node.getAttribute('data-mindmap-session') === sid),
  }), busySessionId)
  check('会话还在跑时删除：先停止工作再重试删除',
    busyDelete.stopCalls >= 1 && busyDelete.stillThere === false,
    JSON.stringify(busyDelete))
  }

  // ---- 15. no runtime errors ------------------------------------------
  const pluginErrors = consoleErrors.filter(text => !text.includes('favicon') && !text.includes('client bundle evaluated'))
  check('无 JS 异常', pluginErrors.length === 0, pluginErrors.slice(0, 2).join(' | '))
} catch (error) {
  console.error('\nprobe crashed:', error)
  if (consoleErrors.length > 0) console.error('page errors:', consoleErrors.slice(0, 5).join('\n---\n'))
  failures += 1
} finally {
  try { await browser?.close() } catch { /* already gone */ }
  edge.kill()
  server.close()
}

const failed = results.filter(entry => !entry.passed)
failures += failed.length

console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) {
  console.log('failed:')
  for (const entry of failed) console.log(`  - ${entry.name}: ${entry.detail ?? ''}`)
}
process.exit(failures === 0 ? 0 : 1)

  // 卡片在画布上的真实渲染尺寸（布局常量是 224x120，但卡片高度随内容变化）
  const nodeSizes = await page.evaluate(() => {
    const sizes = [...document.querySelectorAll('.react-flow__node')].map(node => {
      const box = node.getBoundingClientRect()
      const scale = window.__probeScale ?? 1
      return { w: Math.round(box.width / scale), h: Math.round(box.height / scale) }
    })
    const heights = sizes.map(size => size.h).filter(value => value > 0)
    return { count: sizes.length, widths: [...new Set(sizes.map(size => size.w))], min: Math.min(...heights), max: Math.max(...heights) }
  })
  check('卡片真实尺寸（用于连线避障）', nodeSizes.count > 0, JSON.stringify(nodeSizes))


