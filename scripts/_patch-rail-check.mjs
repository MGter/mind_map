/** Rewrite the rail check with selectors that do not match their own children, plus a drag test. */
import fs from 'node:fs'

const file = 'scripts/_status-rail-check.mjs'
let text = fs.readFileSync(file, 'utf8')

text = text.replace(
  `  const rows = [...document.querySelectorAll('[class*="statusRailRow"]')].map(element => ({
    title: (element.querySelector('[class*="statusRailRowTitle"]')?.textContent ?? '').trim(),
    lamp: (element.querySelector('[class*="statusRailRowLamp"]')?.textContent ?? '').trim(),
  }))`,
  `  const rows = [...document.querySelectorAll('[class*="statusRailPanel"] [role="listitem"]')].map(element => ({
    title: (element.querySelector('[class*="statusRailRowTitle"]')?.textContent ?? '').trim(),
    lamp: (element.querySelector('[class*="statusRailRowLamp"]')?.textContent ?? '').trim(),
    cardClass: element.className,
  }))`,
)

text = text.replace(
  `  const litCards = [...document.querySelectorAll('[data-mindmap-session]')].filter(element => {
    const text = element.textContent ?? ''
    return /运行中|等你回复|待查看|异常终止/.test(text)
  }).length`,
  `  const litCards = [...document.querySelectorAll('[data-mindmap-session]')].filter(element =>
    element.querySelector('[class*="cardLamp"]') !== null).length`,
)

text = text.replace(
  `const shot = process.argv.includes('--shot')`,
  `// Drag the second row onto the first: the order must flip and be remembered.
let dragResult = null
const rowHandles = await page.$$('[class*="statusRailPanel"] [role="listitem"]')
if (rowHandles.length >= 2) {
  const before = (await read()).rows.map(row => row.title)
  await rowHandles[1].dragTo(rowHandles[0])
  await page.waitForTimeout(400)
  const after = (await read()).rows.map(row => row.title)
  const stored = await page.evaluate(() => window.localStorage.getItem('dsh.mind-map.status-rail.order.v1'))
  dragResult = { before: before.slice(0, 3), after: after.slice(0, 3), movedToTop: after[0] === before[1], stored: stored !== null }
}

const shot = process.argv.includes('--shot')`,
)

text = text.replace(
  `  listMatches,
}, null, 1))`,
  `  listMatches,
  dragResult,
}, null, 1))`,
)

text = text.replace(
  `process.exitCode = errors.length === 0 && shutByDefault && afterReload.open && opened.rows.length > 0 ? 0 : 1`,
  `process.exitCode = errors.length === 0 && shutByDefault && afterReload.open && opened.rows.length > 0
  && opened.rows.length === opened.litCards && uniqueRows && dragResult !== null && dragResult.movedToTop ? 0 : 1`,
)

fs.writeFileSync(file, text, 'utf8')
console.log('checker updated')
