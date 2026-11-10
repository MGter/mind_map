/** Add search to the stack drawer: title filter + Host-wide content search. */
import fs from 'node:fs'

const file = 'src/client/StackDrawer.tsx'
let source = fs.readFileSync(file, 'utf8')
const J = (lines) => lines.join('\n')

// ---- props --------------------------------------------------------------
source = source.replace(
  J([
    '  /** Right-click on a card: the same card menu the grid uses. */',
    '  onCardMenu?: (cardId: string, event: React.MouseEvent) => void',
  ]),
  J([
    '  /** Right-click on a card: the same card menu the grid uses. */',
    '  onCardMenu?: (cardId: string, event: React.MouseEvent) => void',
    '  /**',
    '   * Full-text search across EVERY conversation (the Host session/search).',
    '   * Absent = the drawer only filters its own titles.',
    '   */',
    '  onSearchContent?: (query: string) => Promise<DrawerSearchHit[]>',
    '  /** Open a session found by the content search (it may live in another folder). */',
    '  onOpenSession?: (sessionId: string) => void',
  ]),
)

source = source.replace(
  'export interface StackEntry {',
  J([
    '/** One full-text hit: which conversation, its title, and where it matched. */',
    'export interface DrawerSearchHit {',
    '  sessionId: string',
    '  title: string',
    '  snippet: string',
    '}',
    '',
    'export interface StackEntry {',
  ]),
)

// ---- local state --------------------------------------------------------
source = source.replace(
  '  const scrollerRef = useRef<HTMLDivElement | null>(null)',
  J([
    '  const scrollerRef = useRef<HTMLDivElement | null>(null)',
    "  const [query, setQuery] = useState('')",
    '  const [hits, setHits] = useState<DrawerSearchHit[]>([])',
    '  const [searching, setSearching] = useState(false)',
    '',
    '  // Title filter is instant; the content search is debounced and runs on the',
    '  // Host (session/search), so it also covers conversations outside this folder.',
    '  useEffect(() => {',
    '    const trimmed = query.trim()',
    '    if (trimmed.length < 2 || props.onSearchContent === undefined) {',
    '      setHits([])',
    '      setSearching(false)',
    '      return',
    '    }',
    '    let alive = true',
    '    setSearching(true)',
    '    const timer = setTimeout(() => {',
    '      void props.onSearchContent?.(trimmed)',
    '        .then((found) => { if (alive) setHits(found) })',
    '        .catch(() => { if (alive) setHits([]) })',
    '        .finally(() => { if (alive) setSearching(false) })',
    '    }, 300)',
    '    return () => { alive = false; clearTimeout(timer) }',
    '  }, [query, props.onSearchContent])',
    '',
    "  const needle = query.trim().toLowerCase()",
    "  const visibleItems = needle === ''",
    '    ? props.items',
    '    : props.items.filter(item => item.title.toLowerCase().includes(needle))',
  ]),
)

// ---- markup: search box above the scroll area ---------------------------
source = source.replace(
  J([
    '        <div',
    "          className={styles['drawerScroll']}",
  ]),
  J([
    "        <div className={styles['drawerSearchRow']}>",
    '          <input',
    "            className={styles['drawerSearch']}",
    '            value={query}',
    "            placeholder={t('stack.searchPlaceholder')}",
    "            aria-label={t('stack.searchPlaceholder')}",
    '            data-mindmap-drawer-search=""',
    '            onChange={(event) => { setQuery(event.target.value) }}',
    "            onKeyDown={(event) => { if (event.key === 'Escape') event.stopPropagation() }}",
    '          />',
    "          {searching ? <span className={styles['drawerSearchState']}>{t('stack.searching')}</span> : null}",
    '        </div>',
    '        <div',
    "          className={styles['drawerScroll']}",
  ]),
)

// ---- rows: use the filtered list ---------------------------------------
source = source.replace('{props.items.map(item => {', '{visibleItems.map(item => {')

// ---- after the rows: content hits + empty state ------------------------
const tailOld = J([
  '          })}',
  '        </div>',
])
const tailNew = J([
  '          })}',
  "          {needle !== '' && visibleItems.length === 0",
  "            ? <div className={styles['drawerEmpty']}>{t('stack.noTitleMatch')}</div>",
  '            : null}',
  '          {hits.length > 0',
  '            ? (',
  "                      className={styles['drawerHit']}",
  "                      className={styles['drawerHit']}",
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
  "                      className={styles['drawerHit']}",
  "                      className={styles['drawerHit']}",
  '                    </button>',
  '                  ))}',
  '                </div>',
  '              )',
  '            : null}',
  '        </div>',
])
if (!source.includes(tailOld)) {
  console.error('tail anchor missing')
  process.exit(1)
}
source = source.replace(tailOld, tailNew)

fs.writeFileSync(file, source, 'utf8')
console.log('drawer search wired')
