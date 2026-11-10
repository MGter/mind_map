/** Make the stack drawer selection-aware and remount-stable. */
import fs from 'node:fs'

// ---- StackDrawer: selection / current styling + scroll persistence --------
const drawerFile = 'src/client/StackDrawer.tsx'
let drawer = fs.readFileSync(drawerFile, 'utf8')

drawer = drawer.replace(
  `  pendingDraft?: boolean
  interrupted?: boolean
  pinned?: boolean`,
  `  pendingDraft?: boolean
  interrupted?: boolean
  pinned?: boolean
  /** Canvas selection (single pick, or the batch tick) — mirrored here. */
  selected?: boolean
  /** The conversation the map was opened from: same corner brackets as the grid. */
  current?: boolean`,
)

drawer = drawer.replace(
  `import styles from './mind-map.module.css'`,
  `import { drawerState } from './drawer-state.ts'
import styles from './mind-map.module.css'`,
)

// restore / persist the scroll offset of the drawer body
drawer = drawer.replace(
  `  const scrollerRef = useRef<HTMLDivElement | null>(null)`,
  `  const scrollerRef = useRef<HTMLDivElement | null>(null)
  // Coming back from a conversation should land on the same rows.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (scroller === null) return
    scroller.scrollTop = drawerState.readScroll()
  }, [])`,
)

// the row itself: brand border when selected, reticle when it is the origin
drawer = drawer.replace(
  `            if (quiet) classNames.push(styles['cardQuiet'] ?? '')`,
  `            if (quiet) classNames.push(styles['cardQuiet'] ?? '')
            if (item.selected === true) classNames.push(styles['cardSelected'] ?? '')`,
)

fs.writeFileSync(drawerFile, drawer, 'utf8')

// ---- MapCanvas: pass selection through, persist which folder is open ------
const canvasFile = 'src/client/MapCanvas.tsx'
let canvas = fs.readFileSync(canvasFile, 'utf8')

canvas = canvas.replace(
  `        ...(pinnedSessions.has(card.sessionId) ? { pinned: true } : {}),
      })
    }
    return items`,
  `        ...(pinnedSessions.has(card.sessionId) ? { pinned: true } : {}),
        selected: batchMode ? batchPicks.has(cardId) : liveSelectedIds.has(cardId),
        current: currentSessionId() === card.sessionId,
      })
    }
    return items`,
)

canvas = canvas.replace(
  `  const [drawer, setDrawer] = useState<{ groupId: string } | null>(null)`,
  `  // The open drawer survives leaving the map: the folder id lives in
  // localStorage, so reading a conversation and coming back keeps it open.
  const [drawer, setDrawer] = useState<{ groupId: string } | null>(() => {
    const remembered = drawerState.readGroup()
    return remembered === null ? null : { groupId: remembered }
  })
  /** Explicit close: forget the position, the drawer is done. */
  const closeDrawer = (): void => {
    setDrawer(null)
    drawerState.clear()
  }`,
)

canvas = canvas.replace(
  `import { callRpc } from './rpc.ts'`,
  `import { drawerState } from './drawer-state.ts'
import { callRpc } from './rpc.ts'`,
)

fs.writeFileSync(canvasFile, canvas, 'utf8')
console.log('drawer: selection + persistence wired')
