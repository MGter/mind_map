/** Read-only: any persisted trace of our injection (looser patterns). */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const ROOT = path.join(process.env.USERPROFILE ?? '', '.dsh', 'sessions')
const PATTERNS = ['"plugin"', 'mind_map', 'Context injected', '上下文注入', 'plugin:']

function decompress(file) {
  const buffer = fs.readFileSync(file)
  const parts = []
  let offset = 0
  while (offset < buffer.length) {
    const start = buffer.indexOf(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]), offset)
    if (start < 0) break
    const next = buffer.indexOf(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]), start + 4)
    const end = next < 0 ? buffer.length : next
    try { parts.push(zlib.zstdDecompressSync(buffer.subarray(start, end))) } catch { /* frame */ }
    offset = end
  }
  return Buffer.concat(parts).toString('utf8')
}

function walk(dir, out = []) {
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name === 'session.v4.jsonl.zstd') out.push(full)
  }
  return out
}

const files = walk(ROOT)
let found = 0
for (const file of files) {
  let text = ''
  try { text = decompress(file) } catch { continue }
  const hit = PATTERNS.find(pattern => text.includes(pattern))
  if (hit === undefined) continue
  found += 1
  const stat = fs.statSync(file)
  console.log('\n=== MATCH', file, '| pattern:', hit, '| modified:', stat.mtime.toISOString())
  for (const pattern of PATTERNS) {
    const index = text.indexOf(pattern)
    if (index < 0) continue
    console.log('  ', pattern, '→', text.slice(Math.max(0, index - 160), index + 200).replace(/\n/g, ' ⏎ '))
  }
}
console.log('\nfiles matching:', found, 'of', files.length)
