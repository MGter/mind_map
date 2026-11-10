/** Drawer search persistence + per-session loading rows + scroll-scan jump. */
import fs from 'node:fs'
const J = (lines) => lines.join('\n')

// ---- 1. StackDrawer: groupId prop, restore + save its search -----------
let drawer = fs.readFileSync('src/client/StackDrawer.tsx', 'utf8')
drawer = drawer.replace(
  'export interface StackDrawerProps {\n  workspaceTitle: string',
  'export interface StackDrawerProps {\n  /** Storage scope of this folder\'s search. */\n  groupId: string\n  workspaceTitle: string',
)
drawer = drawer.replace(
  "import { drawerState } from './drawer-state.ts'",
  "import { drawerState } from './drawer-state.ts'\nimport { loadSearch, saveSearch } from './search-store.ts'",
)
drawer = drawer.replace(
  "  const [query, setQuery] = useState('')",
  J([
    "  const remembered = loadSearch<DrawerSearchHit>('drawer:' + props.groupId)",
    "  const [query, setQuery] = useState(remembered?.query ?? '')",
  ]),
)
drawer = drawer.replace(
  '  const [hits, setHits] = useState<DrawerSearchHit[]>([])',
  '  const [hits, setHits] = useState<DrawerSearchHit[]>(remembered?.hits ?? [])',
)
drawer = drawer.replace(
  J([
    '      const found = await props.onSearchContent(trimmed)',
    '      setHits(found)',
  ]),
  J([
    '      const found = await props.onSearchContent(trimmed)',
    '      setHits(found)',
    "      saveSearch('drawer:' + props.groupId, { query: trimmed, hits: found })",
  ]),
)
fs.writeFileSync('src/client/StackDrawer.tsx', drawer, 'utf8')

// ---- 2. MapCanvas: pass groupId --------------------------------------
let canvas = fs.readFileSync('src/client/MapCanvas.tsx', 'utf8')
canvas = canvas.replace(
  '            <StackDrawer\n              workspaceTitle=',
  '            <StackDrawer\n              groupId={drawer.groupId}\n              workspaceTitle=',
)
fs.writeFileSync('src/client/MapCanvas.tsx', canvas, 'utf8')

// ---- 3. SearchResults: a shimmer row while a session's hits load ------
let shared = fs.readFileSync('src/client/SearchResults.tsx', 'utf8')
shared = shared.replace(
  '  const [more, setMore] = useState<Record<string, { blocks: string[][]; seqs: (number | null)[] }>>({})',
  J([
    '  const [more, setMore] = useState<Record<string, { blocks: string[][]; seqs: (number | null)[] }>>({})',
    '  /** Sessions whose extra hits are still being fetched. */',
    '  const [pending, setPending] = useState<Record<string, true>>({})',
  ]),
)
shared = shared.replace(
  J([
    '    for (const hit of props.hits.slice(0, 5)) {',
    '      if (more[hit.sessionId] !== undefined) continue',
    '      void props.onFetchSessionHits(hit.sessionId, props.query).then((page) => {',
    '        if (!alive || page.blocks.length <= 1) return',
    '        setMore(previous => (previous[hit.sessionId] === undefined ? { ...previous, [hit.sessionId]: page } : previous))',
    '      }).catch(() => {})',
    '    }',
  ]),
  J([
    '    for (const hit of props.hits.slice(0, 5)) {',
    '      if (more[hit.sessionId] !== undefined) continue',
    '      setPending(previous => (previous[hit.sessionId] === true ? previous : { ...previous, [hit.sessionId]: true }))',
    '      void props.onFetchSessionHits(hit.sessionId, props.query).then((page) => {',
    '        if (!alive) return',
    '        if (page.blocks.length > 1) {',
    '          setMore(previous => (previous[hit.sessionId] === undefined ? { ...previous, [hit.sessionId]: page } : previous))',
    '        }',
    '      }).catch(() => {}).finally(() => {',
    '        if (!alive) return',
    '        setPending(previous => {',
    '          if (previous[hit.sessionId] !== true) return previous',
    '          const next = { ...previous }',
    '          delete next[hit.sessionId]',
    '          return next',
    '        })',
    '      })',
    '    }',
  ]),
)
shared = shared.replace(
  J([
    '            {blocks.map((block, index) => {',
  ]),
  J([
    '            {pending[hit.sessionId] === true',
    '              ? (',
    "                  <div className={styles['searchInlineLoading']} data-mindmap-search-pending={hit.sessionId}>",
    "                    <span className={styles['searchSkeletonLine']} />",
    '                  </div>',
    '                )',
    '              : null}',
    '            {blocks.map((block, index) => {',
  ]),
)
fs.writeFileSync('src/client/SearchResults.tsx', shared, 'utf8')

console.log('drawer persistence + inline loading rows')
