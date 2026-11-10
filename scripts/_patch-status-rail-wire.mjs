/** Wire the status rail into MapCanvas: import, entries memo, focus handler, JSX. */
import fs from 'node:fs'

const file = 'src/client/MapCanvas.tsx'
let text = fs.readFileSync(file, 'utf8')
const lines = text.split('\n')

// 1) import
const importAt = lines.findIndex(line => line.includes("import { StackNode, type StackNodeType } from './StackNode.tsx'"))
if (importAt < 0) { console.log('import anchor missing'); process.exit(1) }
lines.splice(importAt + 1, 0, "import { StatusRail, type StatusRailEntry, type StatusLamp } from './StatusRail.tsx'")

// 2) react-flow helpers
text = lines.join('\n')
const oldFlow = 'const { screenToFlowPosition, zoomTo, setNodes } = useReactFlow()'
if (!text.includes(oldFlow)) { console.log('useReactFlow anchor missing'); process.exit(1) }
text = text.replace(oldFlow, 'const { screenToFlowPosition, zoomTo, setNodes, setCenter, getZoom } = useReactFlow()')

// 3) entries memo + focus handler right after glowOf
const glowEnd = 'const liveNodes = useMemo<MindMapNode[]>(() => {'
if (!text.includes(glowEnd)) { console.log('glow anchor missing'); process.exit(1) }
const block = `  /**
   * The status rail only ever lists cards that are carrying a lamp right now. It is
   * derived, not stored: a card whose status clears drops out by itself.
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

  /** Bring one card into view and select it (the rail row's click). */
  const focusCard = useCallback((cardId: string) => {
    const slot = cardLayout[cardId]
    const card = visibleCards[cardId]
    const point = slot ?? (card === undefined ? undefined : { x: card.x, y: card.y })
    setSelectedIds([cardId])
    if (point === undefined) return
    setCenter(point.x + CARD_W / 2, point.y + CARD_H / 2, { zoom: getZoom(), duration: 320 })
  }, [cardLayout, visibleCards, setCenter, getZoom, setSelectedIds])

`
text = text.replace(glowEnd, block + glowEnd)

// 4) render the rail right after the ReactFlow element
const flowClose = '      </ReactFlow>\n'
if (!text.includes(flowClose)) { console.log('ReactFlow close anchor missing'); process.exit(1) }
text = text.replace(flowClose, flowClose + '      <StatusRail entries={statusEntries} onFocus={focusCard} />\n')

fs.writeFileSync(file, text, 'utf8')
console.log('status rail wired')
