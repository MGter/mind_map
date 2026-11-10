/**
 * Preview the edge light built from the CARD AURA's own gradient profile.
 *
 * The card ring uses a conic gradient with these stops (0 = invisible):
 *   190° 0 → 250° 0.18 → 292° 0.55 → 325° 1.0 → 352° 0.4 → 360° 0
 * i.e. a 47%-wide band: long dark ramp, bright peak, quick fall-off, moving at a
 * constant speed (the ring animation is `linear`).
 *
 * On a path the same profile is built as N adjacent slices — each slice is one
 * dash whose opacity comes from that profile. Adjacent slices tile exactly, so
 * there is no beading, and because they ride the path the corners are exact.
 *
 *   node scripts/_edge-preview.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(candidate => fs.existsSync(candidate))

const D = 'M60 0 H300 Q320 0 320 20 V60 Q320 80 340 80 H640 Q660 80 660 60 V20 Q660 0 680 0 H840'

/** The card ring's stops, as fractions of the band plus their opacity. */
const PROFILE = [
  [0, 0],
  [0.35, 0.18],
  [0.6, 0.55],
  [0.79, 1],
  [0.95, 0.4],
  [1, 0],
]

function opacityAt(f) {
  for (let index = 1; index < PROFILE.length; index += 1) {
    const [f1, o1] = PROFILE[index]
    const [f0, o0] = PROFILE[index - 1]
    if (f <= f1) {
      const t = f1 === f0 ? 0 : (f - f0) / (f1 - f0)
      return o0 + (o1 - o0) * t
    }
  }
  return 0
}

const BAND = 320      // px of the line the light occupies (the window width)
const LINE_X0 = 60
const LINE_X1 = 840
const DUR = 3.6

/**
 * 对称剖面：中间最亮、两端都渐隐。卡片光环是闭环，所以它本来就没有"头"；
 * 线是开环，只给亮头就会读成彗星。这里两端一起淡，光就是一个滑过去的光团。
 */
const PROFILE = [
  [0, 0],
  [0.18, 0.14],
  [0.36, 0.42],
  [0.5, 0.92],
  [0.64, 0.42],
  [0.82, 0.14],
  [1, 0],
]

function rampStops() {
  return PROFILE.map(([f, o]) => `<stop offset="${(f * 100).toFixed(1)}%" stop-color="#fff" stop-opacity="${o}"/>`).join('')
}

const BAND = 300
const LINE_X0 = 60
const LINE_X1 = 840const DUR = 3.6

/** 卡片光环的剖面，换算成遮罩里的白色不透明度。 */
function rampStops() {
  return PROFILE.map(([f, o]) => `<stop offset="${(f * 100).toFixed(1)}%" stop-color="#fff" stop-opacity="${o}"/>`).join('')
}

const html = `<!doctype html>
<meta charset="utf-8" />
<body style="margin:0;background:#16181d;font-family:system-ui">
<svg width="960" height="320" viewBox="0 0 960 320">
  <defs>
    <linearGradient id="ramp" x1="0" y1="0" x2="1" y2="0">${rampStops()}</linearGradient>
    <!-- 一扇窗口：只有窗口内有光，所以任意时刻只有一处亮 -->
    <mask id="win" maskUnits="userSpaceOnUse" x="-400" y="-200" width="1700" height="600">
      <g>
        <animateTransform attributeName="transform" type="translate"
          from="0 0" to="${LINE_X1 - LINE_X0 + BAND} 0" dur="${DUR}s" repeatCount="indefinite"/>
        <rect x="${LINE_X0 - BAND}" y="-200" width="${BAND}" height="600" fill="url(#ramp)"/>
      </g>
    </mask>
  </defs>

  <text x="60" y="30" fill="#8b93a3" font-size="12">复用卡片光环的剖面：一扇渐变的窗口沿线路扫过</text>

  <g transform="translate(0,70)">
    <path d="${D}" fill="none" stroke="rgba(226,232,242,0.6)" stroke-width="1.6" stroke-linecap="round"/>
    <g mask="url(#win)">
      <path d="${D}" fill="none" stroke="rgba(190,214,255,0.75)" stroke-width="10" style="filter:blur(5px)"/>
      <path d="${D}" fill="none" stroke="rgba(255,255,255,0.95)" stroke-width="2.2" style="filter:blur(0.7px)"/>
    </g>
  </g>

  <g transform="translate(0,240)">
    <path d="${D}" fill="none" stroke="rgba(200,206,216,0.34)" stroke-width="1.6"
          stroke-dasharray="6 5" stroke-linecap="round"/>
    <text x="60" y="46" fill="#8b93a3" font-size="11">未同步：灰白静态虚线</text>
  </g>
</svg>
</body>`
const profileDir = path.join(os.tmpdir(), 'mindmap-edge-preview')
fs.rmSync(profileDir, { recursive: true, force: true })
const pageFile = path.join(os.tmpdir(), 'mindmap-edge-preview.html')
fs.writeFileSync(pageFile, html, 'utf8')

const CDP = 9361
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${profileDir}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--window-size=960,340', '--headless=new', 'about:blank',
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
await page.setViewportSize({ width: 960, height: 340 })
await page.goto('file:///' + pageFile.replace(/\\/g, '/'))
await page.waitForTimeout(400)

const outDir = path.join('test', 'shots')
fs.mkdirSync(outDir, { recursive: true })
for (const [index, delay] of [500, 850, 850, 850].entries()) {
  await page.waitForTimeout(delay)
  const file = path.join(outDir, `edge-preview-${index + 1}.png`)
  await page.screenshot({ path: file })
  console.log('shot:', file)
}

await browser.close()
edge.kill()
