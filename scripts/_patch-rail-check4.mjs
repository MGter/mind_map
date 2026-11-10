/** Move the layout-width probe before the browser closes. */
import fs from 'node:fs'

const file = 'scripts/_status-rail-check2.mjs'
let text = fs.readFileSync(file, 'utf8')

// 1) take the probe out of the post-close section
const bad = [
  "const layoutWidth = await page.evaluate(() => {",
  "  const rail = document.querySelector('[class*=\"statusRailCard\"]')",
  "  const board = document.querySelector('[data-mindmap-session]')",
  "  return { rail: rail === null ? 0 : rail.offsetWidth, board: board === null ? 0 : board.offsetWidth }",
  "})",
].join('\n')
if (!text.includes(bad)) { console.log('probe block not found'); process.exit(1) }
text = text.replace(bad, '')

// 2) put it right before the screenshot (page still open)
const anchor = "const shot = process.argv.includes('--shot')"
text = text.replace(anchor, [
  "const layoutWidth = await page.evaluate(() => {",
  "  const rail = document.querySelector('[class*=\"statusRailCard\"]')",
  "  const board = document.querySelector('[data-mindmap-session]')",
  "  return { rail: rail === null ? 0 : rail.offsetWidth, board: board === null ? 0 : board.offsetWidth }",
  "})",
  '',
  anchor,
].join('\n'))

fs.writeFileSync(file, text, 'utf8')
console.log('probe moved before close')
