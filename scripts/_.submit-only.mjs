/** Drawer search runs on Enter / click only, and stays inside this workspace. */
import fs from 'node:fs'
const J = (lines) => lines.join('\n')

const file = 'src/client/StackDrawer.tsx'
let source = fs.readFileSync(file, 'utf8')

// ---- replace the debounced auto-search with an explicit submit --------
const oldEffect = `  // Title filter is instant; the content search is debounced and runs on the
  // Host (session/search), so it also covers conversations outside this folder.
  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2 || props.onSearchContent === undefined) {
      setHits([])
      setSearching(false)
      setSearchError(null)
      return
    }
    let alive = true
    setSearching(true)
    const timer = setTimeout(() => {
      void props.onSearchContent?.(trimmed)
        .then((found) => { if (alive) { setHits(found); setSearchError(null) } })
        .catch((cause) => {
          if (!alive) return
          // Never swallow it: the drawer says what the Host answered, which is
          // the only way to tell "no hits" from "the search did not run".
          console.warn('[mind_map] content search failed:', cause)
          setHits([])
          setSearchError(String(cause?.message ?? cause))
        })
        .finally(() => { if (alive) setSearching(false) })
    }, 300)
    return () => { alive = false; clearTimeout(timer) }
  }, [query, props.onSearchContent])`
const newEffect = `  // The title filter is instant and local. The content search costs a corpus
  // query, so it runs only when the user submits (Enter or the 搜索 button) —
  // not on every keystroke.
  const runSearch = async (): Promise<void> => {
    const trimmed = query.trim()
    if (trimmed.length < 2 || props.onSearchContent === undefined) {
      setHits([])
      setSearchError(null)
      return
    }
    setSearching(true)
    try {
      const found = await props.onSearchContent(trimmed)
      setHits(found)
      setSearchError(null)
    } catch (cause) {
      console.warn('[mind_map] content search failed:', cause)
      setHits([])
      setSearchError(String((cause as Error)?.message ?? cause))
    } finally {
      setSearching(false)
    }
  }`
if (!source.includes(oldEffect)) {
  console.error('drawer search effect not found')
  process.exit(1)
}
source = source.replace(oldEffect, newEffect)

// ---- input: Enter (and a button) submits ------------------------------
const oldInput = J([
  "          <input",
  "            className={styles['drawerSearch']}",
  '            value={query}',
  "            placeholder={t('stack.searchPlaceholder')}",
  "            aria-label={t('stack.searchPlaceholder')}",
  '            data-mindmap-drawer-search=""',
  '            onChange={(event) => { setQuery(event.target.value) }}',
  "            onKeyDown={(event) => { if (event.key === 'Escape') event.stopPropagation() }}",
  '          />',
])
const newInput = J([
  "          <input",
  "            className={styles['drawerSearch']}",
  '            value={query}',
  "            placeholder={t('stack.searchPlaceholder')}",
  "            aria-label={t('stack.searchPlaceholder')}",
  '            data-mindmap-drawer-search=""',
  '            onChange={(event) => {',
  '              setQuery(event.target.value)',
  '              // Clearing the box forgets the previous search, so the list goes',
  '              // back to the whole folder without another request.',
  "              if (event.target.value.trim() === '') { setHits([]); setSearchError(null) }",
  '            }}',
  '            onKeyDown={(event) => {',
  "              if (event.key === 'Escape') { event.stopPropagation(); return }",
  "              if (event.key !== 'Enter') return",
  '              event.preventDefault()',
  '              void runSearch()',
  '            }}',
  '          />',
  '          <button',
  '            type="button"',
  "            className={styles['drawerSearchGo']}",
  '            data-mindmap-drawer-search-run=""',
  '            onClick={() => { void runSearch() }}',
  '          >',
  "            {t('global.searchRun')}",
  '          </button>',
])
if (!source.includes(oldInput)) {
  console.error('drawer input block not found')
  process.exit(1)
}
source = source.replace(oldInput, newInput)

fs.writeFileSync(file, source, 'utf8')
console.log('drawer: submit-only search')
