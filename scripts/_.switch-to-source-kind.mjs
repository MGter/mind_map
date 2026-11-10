/**
 * One-off: rewrite the last-user route's message filter to use `source.kind`
 * instead of text patterns. Three dialects to patch — the src host, the built
 * host bundle, and (client-side) nothing, since preview-text.ts now exports a
 * one-line predicate.
 * Idempotent.
 */
import fs from 'node:fs'

const ROUTE_JS = (indent) => {
  const T = indent
  return [
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
    `${T}${T}${T}${T}${T}// Only messages the human sent: the runtime tags everything it injects`,
    `${T}${T}${T}${T}${T}// (runtime-context, time-context, dsh-mnemon, skill-catalog, …) with its own kind.`,
    `${T}${T}${T}${T}${T}if (!isHumanMessage(event.data?.source)) continue;`,
    `${T}${T}${T}${T}${T}if (!Array.isArray(event.data?.content)) continue;`,
    `${T}${T}${T}${T}${T}const joined = event.data.content.filter((block) => typeof block === "object" && block !== null && block.type === "text" && typeof block.text === "string").map((block) => block.text).join("\\n").trim();`,
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
}

// ---- built host bundle -----------------------------------------------------
const file = new URL('../lib/index.js', import.meta.url)
let text = fs.readFileSync(file, 'utf8')
const marker = 'if (route === "POST /mind-map/last-user") {'
const start = text.indexOf(marker)
if (start < 0) {
  console.error('built: route not found')
  process.exit(1)
}
let depth = 0
let end = -1
for (let i = text.indexOf('{', start); i < text.length; i += 1) {
  if (text[i] === '{') depth += 1
  else if (text[i] === '}') {
    depth -= 1
    if (depth === 0) { end = i; break }
  }
}
if (end < 0) {
  console.error('built: route end not found')
  process.exit(1)
}
text = text.slice(0, start) + ROUTE_JS('\t'.repeat(4)) + text.slice(end + 1)

// Replace the old text-cleaning helpers with the one predicate.
const helperStart = text.indexOf('function isEnvelopeOnly(text) {')
const stripStart = text.indexOf('function stripEnvelopes(text) {')
if (helperStart < 0 || stripStart < 0) {
  console.error('built: helpers not found')
  process.exit(1)
}
const stripEnd = text.indexOf('\n}\n', stripStart)
const predicate = `function isHumanMessage(source) {
	const kind = source?.kind;
	return kind === void 0 || kind === "user";
}`
text = text.slice(0, helperStart) + predicate + text.slice(stripEnd + 2)
fs.writeFileSync(file, text, 'utf8')
console.log('built host bundle: last-user uses source.kind')

// ---- src host --------------------------------------------------------------
const srcFile = 'src/host/routes.ts'
let src = fs.readFileSync(srcFile, 'utf8')
const srcRouteStart = src.indexOf("        if (route === 'POST /mind-map/last-user') {")
if (srcRouteStart < 0) {
  console.error('src: route not found')
  process.exit(1)
}
let srcDepth = 0
let srcEnd = -1
for (let i = src.indexOf('{', srcRouteStart); i < src.length; i += 1) {
  if (src[i] === '{') srcDepth += 1
  else if (src[i] === '}') {
    srcDepth -= 1
    if (srcDepth === 0) { srcEnd = i; break }
  }
}
const srcRoute = [
  "        if (route === 'POST /mind-map/last-user') {",
  '          const body = await readJsonBody(request)',
  '          const ids = Array.isArray((body as { sessionIds?: unknown }).sessionIds)',
  "            ? ((body as { sessionIds: unknown[] }).sessionIds.filter(id => typeof id === 'string') as string[]).slice(0, 200)",
  '            : []',
  '          const texts: Record<string, string> = {}',
  '          const query = runtime.sessionQuery',
  '          if (query !== undefined) {',
  '            // ~250ms per surface read; read them concurrently — a board has ~20.',
  '            await Promise.all(ids.map(async (sessionId) => {',
  '              try {',
  '                const surface = await query.readSurface(sessionId)',
  "                let text = ''",
  '                for (const raw of surface.events) {',
  '                  const event = raw as { type?: string; data?: { source?: MessageSource; content?: unknown } }',
  "                  if (event.type !== 'user/message') continue",
  '                  // Only what the human sent: the runtime tags everything it',
  '                  // injects with its own `source.kind` (runtime-context,',
  '                  // time-context, dsh-mnemon, skill-catalog, …).',
  '                  if (!isHumanMessage(event.data?.source)) continue',
  "                  const body' = textOfBlocks(event.data?.content)",
  "                  if (body' !== '') text = body'",
  '                }',
  "                if (text !== '') texts[sessionId] = text.length > 240 ? text.slice(0, 240) : text",
  '              } catch {',
  '                // A session without a readable surface simply has no preview.',
  '              }',
  '            }))',
  '          }',
  '          sendJson(response, 200, { texts })',
  '          return',
  '        }',
].join('\n').replaceAll("body'", 'body')
src = src.slice(0, srcRouteStart) + srcRoute + src.slice(srcEnd + 1)

const srcHelperStart = src.indexOf('const ENVELOPE_MARKERS: readonly RegExp[] = [')
const srcStripStart = src.indexOf('function stripEnvelopes(text: string): string {')
if (srcHelperStart < 0 || srcStripStart < 0) {
  console.error('src: helpers not found')
  process.exit(1)
}
const srcStripEnd = src.indexOf('\n}\n', srcStripStart)
const srcPredicate = `/** Only messages the human sent; the runtime tags its own injections. */
export interface MessageSource {
  readonly kind?: string
}

function isHumanMessage(source: MessageSource | undefined): boolean {
  const kind = source?.kind
  return kind === undefined || kind === 'user'
}`
src = src.slice(0, srcHelperStart) + srcPredicate + src.slice(srcStripEnd + 2)
fs.writeFileSync(srcFile, src, 'utf8')
console.log('src host: last-user uses source.kind')
