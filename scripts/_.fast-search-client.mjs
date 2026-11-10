/** Client: 1-call search + "more hits in this conversation" on demand + query cache. */
import fs from 'node:fs'
const J = (lines) => lines.join('\n')

// ---- api.ts ------------------------------------------------------------
let api = fs.readFileSync('src/client/api.ts', 'utf8')
api = api.replace(
  "  /** The passage around one hit — fetched only when the pointer rests on it. */",
  J([
    '  /** Every extra hit inside ONE conversation (asked for explicitly). */',
    '  searchSessionHits(sessionId: string, query: string): Promise<{',
    '    blocks: string[][]',
    '    seqs: (number | null)[]',
    '  }> {',
    "    return postJson('/mind-map/search-session', { sessionId, query })",
    '  },',
    '  /** The passage around one hit — fetched only when the pointer rests on it. */',
  ]),
)
fs.writeFileSync('src/client/api.ts', api, 'utf8')

// ---- rpc.ts: cache + fetchSessionHits ---------------------------------
let rpc = fs.readFileSync('src/client/rpc.ts', 'utf8')
rpc += `
/** Repeating the same query inside a minute should not hit the corpus again. */
const searchCache = new Map<string, { at: number; hits: ContentHit[] }>()
const SEARCH_CACHE_MS = 60_000

/** Extra hits inside one conversation, loaded when the user asks for them. */
export async function fetchSessionHits(
  sessionId: string,
  query: string,
): Promise<{ blocks: string[][]; seqs: (number | null)[] }> {
  try {
    const page = await mindMapApi.searchSessionHits(sessionId, query)
    const blocks = (page.blocks ?? []).filter(block => Array.isArray(block) && block.length > 0)
    return { blocks, seqs: blocks.map((_, index) => (typeof page.seqs?.[index] === 'number' ? page.seqs[index] : null)) }
  } catch (error) {
    reportToHost({ phase: 'search-session-failed', sessionId, message: String((error as Error)?.message ?? error) })
    return { blocks: [], seqs: [] }
  }
}
`
fs.writeFileSync('src/client/rpc.ts', rpc, 'utf8')

// wire the cache into searchSessions
rpc = fs.readFileSync('src/client/rpc.ts', 'utf8')
const head = 'export async function searchSessions(query: string): Promise<ContentHit[]> {'
const cachedHead = J([
  'export async function searchSessions(query: string): Promise<ContentHit[]> {',
  '  const key = query.trim().toLowerCase()',
  '  const remembered = searchCache.get(key)',
  '  if (remembered !== undefined && Date.now() - remembered.at < SEARCH_CACHE_MS) return remembered.hits',
  '  const hits = await searchSessionsUncached(query)',
  '  searchCache.set(key, { at: Date.now(), hits })',
  '  return hits',
  '}',
  '',
  'async function searchSessionsUncached(query: string): Promise<ContentHit[]> {',
])
if (!rpc.includes(head)) {
  console.error('searchSessions head not found')
  process.exit(1)
}
rpc = rpc.replace(head, cachedHead)
fs.writeFileSync('src/client/rpc.ts', rpc, 'utf8')

// ---- MapCanvas: pass the session-hits fetcher -------------------------
let canvas = fs.readFileSync('src/client/MapCanvas.tsx', 'utf8')
canvas = canvas.replace(
  '              onFetchContext={(sessionId, seq, query) => fetchSearchContext(sessionId, seq, query)}',
  J([
    '              onFetchContext={(sessionId, seq, query) => fetchSearchContext(sessionId, seq, query)}',
    '              onFetchSessionHits={(sessionId, query) => fetchSessionHits(sessionId, query)}',
  ]),
)
canvas = canvas.replace(
  "import { callRpc, fetchSearchContext, searchSessions } from './rpc.ts'",
  "import { callRpc, fetchSearchContext, fetchSessionHits, searchSessions } from './rpc.ts'",
)
fs.writeFileSync('src/client/MapCanvas.tsx', canvas, 'utf8')

console.log('client: single-call search + lazy session hits')
