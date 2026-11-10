/** Surface content-search state (and its errors), and put hits above the rows. */
import fs from 'node:fs'

const file = 'src/client/StackDrawer.tsx'
let source = fs.readFileSync(file, 'utf8')
const J = (lines) => lines.join('\n')

// ---- state: keep the failure so the UI can say why ----------------------
source = source.replace(
  "  const [searching, setSearching] = useState(false)",
  J([
    '  const [searching, setSearching] = useState(false)',
    '  const [searchError, setSearchError] = useState<string | null>(null)',
  ]),
)

source = source.replace(
  J([
    '    if (trimmed.length < 2 || props.onSearchContent === undefined) {',
    '      setHits([])',
    '      setSearching(false)',
    '      return',
    '    }',
  ]),
  J([
    '    if (trimmed.length < 2 || props.onSearchContent === undefined) {',
    '      setHits([])',
    '      setSearching(false)',
    '      setSearchError(null)',
    '      return',
    '    }',
  ]),
)

source = source.replace(
  J([
    '      void props.onSearchContent?.(trimmed)',
    '        .then((found) => { if (alive) setHits(found) })',
    '        .catch(() => { if (alive) setHits([]) })',
    '        .finally(() => { if (alive) setSearching(false) })',
  ]),
  J([
    '      void props.onSearchContent?.(trimmed)',
    '        .then((found) => { if (alive) { setHits(found); setSearchError(null) } })',
    '        .catch((cause) => {',
    '          if (!alive) return',
    '          // Never swallow it: the drawer says what the Host answered, which is',
    '          // the only way to tell "no hits" from "the search did not run".',
    "          console.error('[mind_map] content search failed:', cause)",
    '          setHits([])',
    '          setSearchError(String(cause?.message ?? cause))',
    '        })',
    '        .finally(() => { if (alive) setSearching(false) })',
  ]),
)

// ---- status line under the input ---------------------------------------
source = source.replace(
  "          {searching ? <span className={styles['drawerSearchState']}>{t('stack.searching')}</span> : null}",
  J([
    "          {searching ? <span className={styles['drawerSearchState']}>{t('stack.searching')}</span> : null}",
    "          {searchError !== null",
    "            ? <span className={styles['drawerSearchError']} title={searchError}>{t('stack.searchFailed')}</span>",
    '            : null}',
  ]),
)

// ---- move the hits block ABOVE the rows --------------------------------
const hitsBlock = J([
  '          {hits.length > 0',
  '            ? (',
  "                <div className={styles['drawerHits']}>",
  "                  <div className={styles['drawerHitsHead']}>",
  "                    {t('stack.contentHits', { n: String(hits.length) })}",
  '                  </div>',
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
  '                </div>',
  '              )',
  '            : null}',
])
if (!source.includes(hitsBlock)) {
  console.error('hits block not found')
  process.exit(1)
}
source = source.replace(`\n${hitsBlock}`, '')
source = source.replace(
  "          {needle !== '' && visibleItems.length === 0",
  `${hitsBlock}\n          {needle !== '' && visibleItems.length === 0`,
)

fs.writeFileSync(file, source, 'utf8')
console.log('search state surfaced, hits moved above the rows')
