/** Client: hits carry 3-line blocks (one above / the match / one below). */
import fs from 'node:fs'

// ---- api.ts: widen the route type ---------------------------------------
let api = fs.readFileSync('src/client/api.ts', 'utf8')
api = api.replace(
  "  searchSessions(query: string): Promise<{ items: { sessionId: string; lines?: string[]; snippet?: string }[]; hasMore?: boolean }> {",
  "  searchSessions(query: string): Promise<{ items: { sessionId: string; blocks?: string[][]; lines?: string[]; snippet?: string }[]; hasMore?: boolean }> {",
)
fs.writeFileSync('src/client/api.ts', api, 'utf8')

// ---- rpc.ts: ContentHit.blocks + normalisation -------------------------
let rpc = fs.readFileSync('src/client/rpc.ts', 'utf8')
rpc = rpc.replace(
  "export interface ContentHit {\n  sessionId: string\n  /** Every matched line inside that conversation (grouped per session). */\n  lines: string[]\n}",
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
)

const oldNormalize = `  const normalize = (
    items: readonly { sessionId?: string; lines?: string[]; snippet?: string }[] | undefined,
  ): ContentHit[] =>
    (items ?? [])
      .filter((item): item is { sessionId: string; lines?: string[]; snippet?: string } => typeof item.sessionId === 'string')
      .map((item) => {
        const lines = Array.isArray(item.lines) ? item.lines.filter(line => typeof line === 'string' && line !== '') : []
        if (lines.length === 0 && typeof item.snippet === 'string' && item.snippet !== '') lines.push(item.snippet)
        return { sessionId: item.sessionId, lines }
      })
      .filter(hit => hit.lines.length > 0)`
const newNormalize = `  const clean = (lines: readonly unknown[]): string[] =>
    lines.filter((line): line is string => typeof line === 'string' && line.trim() !== '')
  const normalize = (
    items: readonly { sessionId?: string; blocks?: string[][]; lines?: string[]; snippet?: string }[] | undefined,
  ): ContentHit[] =>
    (items ?? [])
      .filter((item): item is { sessionId: string; blocks?: string[][]; lines?: string[]; snippet?: string } =>
        typeof item.sessionId === 'string')
      .map((item) => {
        // New shape: blocks of context lines. Older shapes are wrapped so the
        // drawer renders the same way whatever the Host answers.
        if (Array.isArray(item.blocks)) {
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
        return { sessionId: item.sessionId, blocks: [] }
      })
      .filter(hit => hit.blocks.length > 0)`
if (!rpc.includes(oldNormalize)) {
  console.error('normalize block not found')
  process.exit(1)
}
rpc = rpc.replace(oldNormalize, newNormalize)
rpc = rpc.replace(
  "callRpc<{ items?: { sessionId: string; lines?: string[]; snippet?: string }[] }>('session/search', { query })",
  "callRpc<{ items?: { sessionId: string; blocks?: string[][]; lines?: string[]; snippet?: string }[] }>('session/search', { query })",
)
fs.writeFileSync('src/client/rpc.ts', rpc, 'utf8')

// ---- MapCanvas: pass blocks through ------------------------------------
let canvas = fs.readFileSync('src/client/MapCanvas.tsx', 'utf8')
canvas = canvas.replace('                  lines: hit.lines,', '                  blocks: hit.blocks,')
fs.writeFileSync('src/client/MapCanvas.tsx', canvas, 'utf8')

// ---- StackDrawer: block rendering --------------------------------------
let drawer = fs.readFileSync('src/client/StackDrawer.tsx', 'utf8')
drawer = drawer.replace(
  [
    '/**',
    ' * One conversation that matched: every matched line lives inside it, so a',
    ' * session with five hits is ONE block with five lines, not five blocks.',
    ' */',
    'export interface DrawerSearchHit {',
    '  sessionId: string',
    '  title: string',
    '  lines: string[]',
    '}',
  ].join('\n'),
  [
    '/**',
    ' * One conversation that matched. Each match is a small block of context',
    ' * lines (one above / the match / one below), so a session with several hits',
    ' * is ONE section with several blocks.',
    ' */',
    'export interface DrawerSearchHit {',
    '  sessionId: string',
    '  title: string',
    '  blocks: string[][]',
    '}',
  ].join('\n'),
)

const oldLinesMarkup = `                      {hit.lines.map((line, index) => (
                        <button
                          key={index}
                          type="button"
                          className={styles['drawerHitLine']}
                          data-mindmap-search-line={hit.sessionId}
                          onClick={() => { props.onOpenSession?.(hit.sessionId) }}
                        >
                          {highlight(line, query)}
                        </button>
                      ))}`
const newLinesMarkup = `                      {hit.blocks.map((block, blockIndex) => (
                        <div key={blockIndex} className={styles['drawerHitBlock']}>
                          {block.map((line, lineIndex) => (
                            <button
                              key={lineIndex}
                              type="button"
                              className={styles['drawerHitLine']}
                              data-mindmap-search-line={hit.sessionId}
                              onClick={() => { props.onOpenSession?.(hit.sessionId) }}
                            >
                              {highlight(line, query)}
                            </button>
                          ))}
                        </div>
                      ))}`
if (!drawer.includes(oldLinesMarkup)) {
  console.error('drawer line markup not found')
  process.exit(1)
}
drawer = drawer.replace(oldLinesMarkup, newLinesMarkup)
fs.writeFileSync('src/client/StackDrawer.tsx', drawer, 'utf8')

console.log('client: 3-line context blocks wired')
