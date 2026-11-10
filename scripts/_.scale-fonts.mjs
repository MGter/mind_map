/**
 * One-off: make every text size in the map scale by a CSS variable.
 *
 * `font-size: 12px` → `font-size: calc(12px + var(--tm-font-step, 0px))`, so the
 * header's +/− buttons shift EVERY element by the same amount while keeping each
 * element's own base size (not one uniform size — the request was "all fonts +1
 * step", not "all fonts equal").
 *
 * Idempotent: lines that already carry the var are skipped.
 */
import fs from 'node:fs'

const file = 'src/client/mind-map.module.css'
const source = fs.readFileSync(file, 'utf8')
let count = 0
const next = source.replace(/font-size:\s*(\d+(?:\.\d+)?)px;/g, (match, size) => {
  count += 1
  return `font-size: calc(${size}px + var(--tm-font-step, 0px));`
})
fs.writeFileSync(file, next, 'utf8')
console.log(`font-size declarations scaled: ${count}`)
