/** Client: lazy context on hover, native scrolling, no hover churn while scrolling. */
import fs from 'node:fs'

// ---- api.ts: context route --------------------------------------------
let api = fs.readFileSync('src/client/api.ts', 'utf8')
api = api.replace(
  "  searchSessions(query: string): Promise<{ items: { sessionId: string; blocks?: string[][]; lines?: string[]; snippet?: string }[]; hasMore?: boolean }> {\n    return postJson('/mind-map/search', { query })\n  },",
  [
    "  searchSessions(query: string): Promise<{",
    '    items: { sessionId: string; blocks?: string[][]; seqs?: (number | null)[]; lines?: string[]; snippet?: string }[]',
    '    hasMore?: boolean',
    '  }> {',
    "    return postJson('/mind-map/search', { query })",
    '  },',
    '  /** The passage around one hit — fetched only when the pointer rests on it. */',
    '  searchContext(sessionId: string, seq: number, query: string): Promise<{ lines: string[] }> {',
    "    return postJson('/mind-map/search-context', { sessionId, seq, query })",
    '  },',
  ].join('\n'),
)
fs.writeFileSync('src/client/api.ts', api, 'utf8')

// ---- rpc.ts: seqs + fetchContext --------------------------------------
let rpc = fs.readFileSync('src/client/rpc.ts', 'utf8')
rpc = rpc.replace(
  [
    'export interface ContentHit {',
    '  sessionId: string',
    '  /**',
    '   * One entry per match, each holding the matched line together with the line',
    '   * above and below it — a bare snippet is too little to recognise.',
    '   */',
    '  blocks: string[][]',
    '}',
  ].join('\n'),
  [
    'export interface ContentHit {',
    '  sessionId: string',
    '  /** One entry per match; each holds the matched line (index 1 of its block). */',
    '  blocks: string[][]',
    '  /** Event seq per match, so the passage can be pulled on demand. */',
    '  seqs: (number | null)[]',
    '}',
  ].join('\n'),
)

const oldNormalizeHead = `  const normalize = (
    items: readonly { sessionId?: string; blocks?: string[][]; lines?: string[]; snippet?: string }[] | undefined,
  ): ContentHit[] =>`
const newNormalizeHead = `  const normalize = (
    items: readonly {
      sessionId?: string
      blocks?: string[][]
      seqs?: (number | null)[]
      lines?: string[]
      snippet?: string
    }[] | undefined,
  ): ContentHit[] =>`
if (!rpc.includes(oldNormalizeHead)) {
  console.error('normalize head not found')
  process.exit(1)
}
rpc = rpc.replace(oldNormalizeHead, newNormalizeHead)

const oldBranches = `        if (Array.isArray(item.blocks)) {
          const blocks = item.blocks.map(clean).filter(block => block.length > 0)
          if (blocks.length > 0) return { sessionId: item.sessionId, blocks }
        }
        if (Array.isArray(item.lines)) {
          const lines = clean(item.lines)
          if (lines.length > 0) return { sessionId: item.sessionId, blocks: lines.map(line => [line]) }
        }
        if (typeof item.snippet === 'string' && item.snippet.trim() !== '') {
          return { sessionId: item.sessionId, blocks: [[item.snippet.trim()]] }
        }
        return { sessionId: item.sessionId, blocks: [] }`
const newBranches = `        const seqs = Array.isArray(item.seqs) ? item.seqs : []
        const withSeqs = (blocks: string[][]): ContentHit => ({
          sessionId: item.sessionId,
          blocks,
          seqs: blocks.map((_, index) => (typeof seqs[index] === 'number' ? seqs[index] : null)),
        })
        if (Array.isArray(item.blocks)) {
          const blocks = item.blocks.map(clean).filter(block => block.length > 0)
          if (blocks.length > 0) return withSeqs(blocks)
        }
        if (Array.isArray(item.lines)) {
          const lines = clean(item.lines)
          if (lines.length > 0) return withSeqs(lines.map(line => [line]))
        }
        if (typeof item.snippet === 'string' && item.snippet.trim() !== '') {
          return withSeqs([[item.snippet.trim()]])
        }
        return { sessionId: item.sessionId, blocks: [], seqs: [] }`
if (!rpc.includes(oldBranches)) {
  console.error('normalize branches not found')
  process.exit(1)
}
rpc = rpc.replace(oldBranches, newBranches)

rpc += `
/** The passage around one hit, loaded when the pointer rests on it. */
export async function fetchSearchContext(sessionId: string, seq: number, query: string): Promise<string[]> {
  try {
    const page = await mindMapApi.searchContext(sessionId, seq, query)
    return Array.isArray(page.lines) ? page.lines.filter(line => typeof line === 'string' && line !== '') : []
  } catch (error) {
    reportToHost({ phase: 'search-context-failed', sessionId, seq, message: String((error as Error)?.message ?? error) })
    return []
  }
}
`
fs.writeFileSync('src/client/rpc.ts', rpc, 'utf8')

console.log('api/rpc updated')
