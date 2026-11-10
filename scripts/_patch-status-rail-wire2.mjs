/** Apply the parts of the status-rail wiring that the earlier run lost (it exited early). */
import fs from 'node:fs'

const file = 'src/client/MapCanvas.tsx'
const lines = fs.readFileSync(file, 'utf8').split('\n')

const has = (needle) => lines.some(line => line.includes(needle))

// 1) import
if (!has("from './StatusRail.tsx'")) {
  const at = lines.findIndex(line => line.includes("from './StackNode.tsx'"))
  if (at < 0) { console.log('StackNode import anchor missing'); process.exit(1) }
  lines.splice(at + 1, 0, "import { StatusRail, type StatusRailEntry, type StatusLamp } from './StatusRail.tsx'")
}

// 2) react-flow helpers
const flowAt = lines.findIndex(line => line.includes('const { screenToFlowPosition, zoomTo, setNodes } = useReactFlow()'))
if (flowAt < 0) { console.log('useReactFlow anchor missing'); process.exit(1) }
lines[flowAt] = '  const { screenToFlowPosition, zoomTo, setNodes, setCenter, getZoom } = useReactFlow()'

// 3) entries memo + focus handler, right before liveNodes
const liveAt = lines.findIndex(line => line.includes('const liveNodes = useMemo<MindMapNode[]>(() => {'))
if (liveAt < 0) { console.log('liveNodes anchor missing'); process.exit(1) }
const block = `  /**
   * The status rail lists only the cards that carry a lamp right now. It is derived, not
   * stored, so a card whose status clears leaves the list on its own.
   */
  const statusEntries = useMemo<StatusRailEntry[]>(() => {
    const rows: StatusRailEntry[] = []
    for (const [cardId, card] of Object.entries(visibleCards)) {
      if (card.boardId !== INBOX_BOARD_ID) continue
      const lamp = glowOf(card.sessionId) as StatusLamp | undefined
      if (lamp === undefined) continue
      const summary = sessions.byId[card.sessionId]
      rows.push({
        cardId,
        sessionId: card.sessionId,
        title: renamedTitles[card.sessionId] ?? summary?.displayTitle ?? card.sessionId,
        lamp,
        stamp: summary?.updatedAt ?? 0,
        ...(summary?.updatedAt !== undefined ? { updatedAt: summary.updatedAt } : {}),
      })
    }
    return rows
  }, [visibleCards, sessions, renamedTitles, statusById, alertById, finishedById])

  /** Bring one card into view and select it (a click on a rail row). */
  const focusCard = useCallback((cardId: string) => {
    const slot = cardLayout[cardId]
    const card = visibleCards[cardId]
    const point = slot ?? (card === undefined ? undefined : { x: card.x, y: card.y })
    setSelectedIds([cardId])
    if (point === undefined) return
    setCenter(point.x + CARD_W / 2, point.y + CARD_H / 2, { zoom: getZoom(), duration: 320 })
  }, [cardLayout, visibleCards, setCenter, getZoom, setSelectedIds])
`
lines.splice(liveAt, 0, ...block.split('\n'))

// 4) useCallback in the React import
const reactAt = lines.findIndex(line => line.startsWith("import {") && line.includes("} from 'react'"))
if (reactAt < 0) { console.log('react import anchor missing'); process.exit(1) }
if (!lines[reactAt].includes('useCallback')) {
  lines[reactAt] = lines[reactAt].replace('import {', 'import { useCallback,')
}

fs.writeFileSync(file, lines.join('\n'), 'utf8')
console.log('wiring applied')
