/**
 * One-off: add a tiny `POST /mind-map/client-boot` route to the built host bundle.
 *
 * The crash report only keeps "mind_map: import failed"; the import error
 * itself dies with the renderer. This route lets the client bundle leave a
 * breadcrumb on disk, so after a failed reload we can tell the two cases apart:
 *
 *   - no line for that boot  → the module was never imported (fetch/parse/loader)
 *   - "evaluate" then "error" → the factory ran and threw (and why)
 *
 * Mirrored in src/host/routes.ts. Idempotent.
 */
import fs from 'node:fs'

const file = new URL('../lib/index.js', import.meta.url)
let text = fs.readFileSync(file, 'utf8')

if (text.includes('/mind-map/client-boot')) {
  console.log('already applied')
  process.exit(0)
}

const anchor = 'if (route === "POST /mind-map/last-user") {'
const start = text.indexOf(anchor)
if (start < 0) {
  console.error('anchor not found')
  process.exit(1)
}

const T = '\t'.repeat(4)
const block = [
  'if (route === "POST /mind-map/client-boot") {',
  `${T}const body = await readJsonBody(request);`,
  `${T}const line = JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...body });`,
  `${T}try {`,
  `${T}${T}await mkdir(join(homedir(), ".dsh"), { recursive: true });`,
  `${T}${T}await appendFile(join(homedir(), ".dsh", "mind-map-client-boot.log"), line + "\\n");`,
  `${T}} catch {}`,
  `${T}sendJson(response, 200, { ok: true });`,
  `${T}return;`,
  '}',
].join('\n')

text = text.slice(0, start) + block + '\n' + text.slice(start)

// The bundle imports only `mkdir` today; the breadcrumb also needs appendFile + join.
if (!text.includes('appendFile')) {
  text = text.replace(
    'import { mkdir } from "node:fs/promises";',
    'import { appendFile, mkdir } from "node:fs/promises";',
  )
  text = text.replace(
    'import { resolve, sep } from "node:path";',
    'import { join, resolve, sep } from "node:path";',
  )
}

fs.writeFileSync(file, text, 'utf8')
console.log('host bundle: client-boot breadcrumb route added')
