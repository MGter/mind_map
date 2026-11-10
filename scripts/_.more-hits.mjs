/** Drawer: "more hits in this conversation" is a button, not part of the search. */
import fs from 'node:fs'

const file = 'src/client/StackDrawer.tsx'
let source = fs.readFileSync(file, 'utf8')
const J = (lines) => lines.join('\n')

// ---- prop -------------------------------------------------------------
source = source.replace(
  '  /** The passage around one hit — fetched on hover, not with the search. */',
  J([
    '  /** Every extra hit inside one conversation, loaded on demand. */',
    '  onFetchSessionHits?: (sessionId: string, query: string) => Promise<{',
    '    blocks: string[][]',
    '    seqs: (number | null)[]',
    '  }>',
    '  /** The passage around one hit — fetched on hover, not with the search. */',
  ]),
)

// ---- state ------------------------------------------------------------
source = source.replace(
  '  const peekTimer = useRef<number | null>(null)',
  J([
    '  const peekTimer = useRef<number | null>(null)',
    '  /** Extra hits per conversation, fetched only when asked for. */',
    '  const [moreHits, setMoreHits] = useState<Record<string, { blocks: string[][]; seqs: (number | null)[] }>>({})',
    '  const [loadingMore, setLoadingMore] = useState<string | null>(null)',
    '',
    '  const expandHits = async (hit: DrawerSearchHit): Promise<void> => {',
    '    if (props.onFetchSessionHits === undefined || loadingMore !== null) return',
    '    setLoadingMore(hit.sessionId)',
    '    try {',
    '      const page = await props.onFetchSessionHits(hit.sessionId, query)',
    '      if (page.blocks.length > 0) setMoreHits(previous => ({ ...previous, [hit.sessionId]: page }))',
    '      else setMoreHits(previous => ({ ...previous, [hit.sessionId]: { blocks: hit.blocks, seqs: hit.seqs ?? [] } }))',
    '    } finally {',
    '      setLoadingMore(null)',
    '    }',
    '  }',
  ]),
)

// ---- rendering: use the expanded set when present ---------------------
const oldRender = J([
  '                      {hit.blocks.map((block, blockIndex) => {',
  '                        // Inline: only the matched line. The rest of the passage',
  '                        // is one hover away (a floating box), so the list stays',
  '                        // scannable instead of turning into walls of text.',
  "                        const matched = block.find(line => line.toLowerCase().includes(needle)) ?? block[0] ?? ''",
  '                        return (',
  '                          <button',
  '                            key={blockIndex}',
  '                            type="button"',
  "                            className={styles['drawerHitLine']}",
  '                            data-mindmap-search-line={hit.sessionId}',
  '                            onClick={() => { props.onOpenSession?.(hit.sessionId) }}',
  '                            onMouseEnter={(event) => { schedulePeek(hit, blockIndex, event) }}',
  '                            onMouseLeave={cancelPeek}',
  '                            onFocus={(event) => { schedulePeek(hit, blockIndex, event as unknown as React.MouseEvent) }}',
  '                            onBlur={cancelPeek}',
  '                          >',
  '                            {highlight(matched, query)}',
  '                          </button>',
  '                        )',
  '                      })}',
])
const newRender = J([
  '                      {(moreHits[hit.sessionId]?.blocks ?? hit.blocks).map((block, blockIndex) => {',
  '                        // Inline: only the matched line. The rest of the passage',
  '                        // is one hover away (a floating box), so the list stays',
  '                        // scannable instead of turning into walls of text.',
  "                        const matched = block.find(line => line.toLowerCase().includes(needle)) ?? block[0] ?? ''",
  '                        const seqs = moreHits[hit.sessionId]?.seqs ?? hit.seqs ?? []',
  '                        return (',
  '                          <button',
  '                            key={blockIndex}',
  '                            type="button"',
  "                            className={styles['drawerHitLine']}",
  '                            data-mindmap-search-line={hit.sessionId}',
  '                            onClick={() => { props.onOpenSession?.(hit.sessionId) }}',
  '                            onMouseEnter={(event) => { schedulePeek(hit, blockIndex, event, seqs[blockIndex] ?? null) }}',
  '                            onMouseLeave={cancelPeek}',
  '                            onFocus={(event) => { schedulePeek(hit, blockIndex, event as unknown as React.MouseEvent, seqs[blockIndex] ?? null) }}',
  '                            onBlur={cancelPeek}',
  '                          >',
  '                            {highlight(matched, query)}',
  '                          </button>',
  '                        )',
  '                      })}',
  '                      {props.onFetchSessionHits !== undefined && moreHits[hit.sessionId] === undefined',
  '                        ? (',
  '                            <button',
  '                              type="button"',
  "                              className={styles['drawerHitMore']}",
  '                              data-mindmap-search-more={hit.sessionId}',
  '                              onClick={() => { void expandHits(hit) }}',
  '                            >',
  "                              {loadingMore === hit.sessionId ? t('stack.moreLoading') : t('stack.moreHits')}",
  '                            </button>',
  '                          )',
  '                        : null}',
])
if (!source.includes(oldRender)) {
  console.error('hit render block not found')
  process.exit(1)
}
source = source.replace(oldRender, newRender)

// ---- schedulePeek takes the seq explicitly ---------------------------
source = source.replace(
  'const schedulePeek = (hit: DrawerSearchHit, index: number, event: React.MouseEvent): void => {',
  'const schedulePeek = (hit: DrawerSearchHit, index: number, event: React.MouseEvent, seq?: number | null): void => {',
)
source = source.replace(
  '    const seq = hit.seqs?.[index]\n',
  '    const eventSeq = seq === undefined ? hit.seqs?.[index] : seq\n',
)
source = source.replace(
  "      if (typeof seq !== 'number' || props.onFetchContext === undefined) return",
  "      if (typeof eventSeq !== 'number' || props.onFetchContext === undefined) return",
)
source = source.replace(
  "      const key = hit.sessionId + ':' + String(seq)",
  "      const key = hit.sessionId + ':' + String(eventSeq)",
)
source = source.replace(
  '      void props.onFetchContext(hit.sessionId, seq, query).then((lines) => {',
  '      void props.onFetchContext(hit.sessionId, eventSeq, query).then((lines) => {',
)

fs.writeFileSync(file, source, 'utf8')
console.log('drawer: more-hits button wired')
