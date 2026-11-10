/** Drawer hits: one block per conversation, one highlighted line per match. */
import fs from 'node:fs'

const file = 'src/client/StackDrawer.tsx'
let source = fs.readFileSync(file, 'utf8')
const J = (lines) => lines.join('\n')

// ---- hit shape: grouped lines ------------------------------------------
source = source.replace(
  J([
    '/** One full-text hit: which conversation, its title, and where it matched. */',
    'export interface DrawerSearchHit {',
    '  sessionId: string',
    '  title: string',
    '  snippet: string',
    '}',
  ]),
  J([
    '/**',
    ' * One conversation that matched: every matched line lives inside it, so a',
    ' * session with five hits is ONE block with five lines, not five blocks.',
    ' */',
    'export interface DrawerSearchHit {',
    '  sessionId: string',
    '  title: string',
    '  lines: string[]',
    '}',
  ]),
)

// ---- highlight helper --------------------------------------------------
source = source.replace(
  '/** The Host answers this when the deployment turned the session index off. */',
  J([
    '/** Split `text` around every occurrence of `query` and mark the matches. */',
    'function highlight(text: string, query: string): React.ReactNode[] {',
    "  const needle = query.trim().toLowerCase()",
    "  if (needle === '') return [text]",
    '  const haystack = text.toLowerCase()',
    '  const parts: React.ReactNode[] = []',
    '  let cursor = 0',
    '  let key = 0',
    '  while (cursor < text.length) {',
    '    const at = haystack.indexOf(needle, cursor)',
    '    if (at < 0) { parts.push(text.slice(cursor)); break }',
    '    if (at > cursor) parts.push(text.slice(cursor, at))',
    "    parts.push(<mark key={key++} className={styles['hitMark']}>{text.slice(at, at + needle.length)}</mark>)",
    '    cursor = at + needle.length',
    '  }',
    '  return parts',
    '}',
    '',
    '/** The Host answers this when the deployment turned the session index off. */',
  ]),
)

// ---- hit list markup ---------------------------------------------------
const oldHits = J([
  '                  {hits.map(hit => (',
  '                    <button',
  '                      key={hit.sessionId}',
  '                      type="button"',
  "                      className={styles['drawerHit']}",
  '                      data-mindmap-search-hit={hit.sessionId}',
  '                      onClick={() => { props.onOpenSession?.(hit.sessionId) }}',
  '                    >',
  "                      <span className={styles['drawerHitTitle']}>{hit.title}</span>",
  "                      <span className={styles['drawerHitSnippet']}>{hit.snippet}</span>",
  '                    </button>',
  '                  ))}',
])
const newHits = J([
  '                  {hits.map(hit => (',
  '                    <div',
  '                      key={hit.sessionId}',
  "                      className={styles['drawerHit']}",
  '                      data-mindmap-search-hit={hit.sessionId}',
  '                    >',
  '                      <button',
  '                        type="button"',
  "                        className={styles['drawerHitTitle']}",
  '                        onClick={() => { props.onOpenSession?.(hit.sessionId) }}',
  '                      >',
  '                        {highlight(hit.title, query)}',
  '                      </button>',
  '                      {hit.lines.map((line, index) => (',
  '                        <button',
  '                          key={index}',
  '                          type="button"',
  "                          className={styles['drawerHitLine']}",
  '                          data-mindmap-search-line={hit.sessionId}',
  '                          onClick={() => { props.onOpenSession?.(hit.sessionId) }}',
  '                        >',
  '                          {highlight(line, query)}',
  '                        </button>',
  '                      ))}',
  '                    </div>',
  '                  ))}',
])
if (!source.includes(oldHits)) {
  console.error('hits markup not found')
  process.exit(1)
}
source = source.replace(oldHits, newHits)

fs.writeFileSync(file, source, 'utf8')
console.log('drawer hits grouped + highlighted')
