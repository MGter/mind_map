/**
 * One-off: hand-patch the built Host bundle (lib/index.js) — the last-user route
 * read each session surface SEQUENTIALLY (~260 ms each, so a 21-card board waited
 * seconds). Read them concurrently instead. Mirrored in src/host/routes.ts.
 * Idempotent.
 */
import fs from 'node:fs'

const file = new URL('../lib/index.js', import.meta.url)
let text = fs.readFileSync(file, 'utf8')

if (text.includes('await Promise.all(ids.map(async (sessionId) => {')) {
  console.log('already applied')
  process.exit(0)
}

const marker = 'if (route === "POST /mind-map/last-user") {'
const start = text.indexOf(marker)
if (start < 0) {
  console.error('route not found')
  process.exit(1)
}
// Find the matching closing brace of the route block.
let depth = 0
let end = -1
for (let i = text.indexOf('{', start); i < text.length; i += 1) {
  const char = text[i]
  if (char === '{') depth += 1
  else if (char === '}') {
    depth -= 1
    if (depth === 0) { end = i; break }
  }
}
if (end < 0) {
  console.error('route end not found')
  process.exit(1)
}

const T = '\t'
const block = [
  'if (route === "POST /mind-map/last-user") {',
  `${T}const body = await readJsonBody(request);`,
  `${T}const ids = Array.isArray(body?.sessionIds) ? body.sessionIds.filter((id) => typeof id === "string").slice(0, 200) : [];`,
  `${T}const texts = {};`,
  `${T}const query = runtime.sessionQuery;`,
  `${T}if (query !== void 0) {`,
  `${T}${T}// One surface read per session costs ~250ms; a board has ~20 cards.`,
  `${T}${T}await Promise.all(ids.map(async (sessionId) => {`,
  `${T}${T}${T}try {`,
  `${T}${T}${T}${T}const surface = await query.readSurface(sessionId);`,
  `${T}${T}${T}${T}let text = "";`,
  `${T}${T}${T}${T}for (const event of surface.events) {`,
  `${T}${T}${T}${T}${T}if (event.type !== "user/message") continue;`,
  `${T}${T}${T}${T}${T}const message = event.data;`,
  `${T}${T}${T}${T}${T}if (message?.source?.kind === "tool") continue;`,
  `${T}${T}${T}${T}${T}if (!Array.isArray(message?.content)) continue;`,
  `${T}${T}${T}${T}${T}const raw = message.content.filter((block) => typeof block === "object" && block !== null && block.type === "text" && typeof block.text === "string").map((block) => block.text).join("\\n").trim();`,
  `${T}${T}${T}${T}${T}if (isEnvelopeOnly(raw)) continue;`,
  `${T}${T}${T}${T}${T}const joined = stripEnvelopes(raw);`,
  `${T}${T}${T}${T}${T}if (joined !== "") text = joined;`,
  `${T}${T}${T}${T}}`,
  `${T}${T}${T}${T}if (text !== "") texts[sessionId] = text.length > 240 ? text.slice(0, 240) : text;`,
  `${T}${T}${T}} catch {}`,
  `${T}${T}}));`,
  `${T}}`,
  `${T}sendJson(response, 200, { texts });`,
  `${T}return;`,
  '}',
].join('\n')

text = text.slice(0, start) + block + text.slice(end + 1)
fs.writeFileSync(file, text, 'utf8')
console.log('host bundle: last-user reads sessions concurrently')
