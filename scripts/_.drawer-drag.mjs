/** Drawer: drag-to-reorder + link chips on each card. */
import fs from 'node:fs'

const file = 'src/client/StackDrawer.tsx'
let source = fs.readFileSync(file, 'utf8')
const EOL = source.includes('\r\n') ? '\r\n' : '\n'
const J = (lines) => lines.join(EOL)

// ---- props: a reorder callback -----------------------------------------
source = source.replace(
  J(['  onClose: () => void', '}']),
  J([
    '  /** A drag inside the drawer landed: `cardId` now sits at `index`. */',
    '  onReorder?: (cardId: string, index: number) => void',
    '  onClose: () => void',
    '}',
  ]),
)

// ---- drag state --------------------------------------------------------
source = source.replace(
  J(['  const [searching, setSearching] = useState(false)']),
  J([
    '  const [searching, setSearching] = useState(false)',
    '  /** The card being dragged inside the drawer, and where it would land. */',
    "  const [dragId, setDragId] = useState<string | null>(null)",
    '  const [dropIndex, setDropIndex] = useState<number | null>(null)',
  ]),
)

// ---- helpers, right before the return ----------------------------------
const returnAnchor = J(['  const scrollSaveTimer = useRef<number | null>(null)', '', '  return ('])
if (!source.includes(returnAnchor)) {
  console.error('return anchor missing')
  process.exit(1)
}
source = source.replace(
  returnAnchor,
  J([
    '  const scrollSaveTimer = useRef<number | null>(null)',
    '',
    '  /** Which slot the pointer is over, among the cards currently rendered. */',
    '  const slotUnder = (clientX: number, clientY: number): number | null => {',
    '    const scroller = scrollerRef.current',
    '    if (scroller === null) return null',
    "    const cards = [...scroller.querySelectorAll('[data-stack-card]')] as HTMLElement[]",
    '    if (cards.length === 0) return null',
    '    let best = 0',
    '    let bestDistance = Number.POSITIVE_INFINITY',
    '    cards.forEach((card, index) => {',
    '      const box = card.getBoundingClientRect()',
    '      const dx = clientX - (box.x + box.width / 2)',
    '      const dy = clientY - (box.y + box.height / 2)',
    '      // Rows matter more than columns: weight the vertical distance.',
    '      const distance = dx * dx + dy * dy * 3',
    '      if (distance < bestDistance) {',
    '        bestDistance = distance',
    '        best = index',
    '      }',
    '    })',
    '    return best',
    '  }',
    '',
    '  const endDrag = (): void => {',
    '    setDragId(null)',
    '    setDropIndex(null)',
    '  }',
    '',
    '  return (',
  ]),
)

// ---- the card becomes draggable ----------------------------------------
source = source.replace(
  J([
    '                onClick={() => { props.onOpenCard(item.cardId) }}',
  ]),
  J([
    '                draggable',
    '                data-mindmap-drag={dragId === item.cardId ? "1" : undefined}',
    '                onDragStart={(event) => {',
    '                  setDragId(item.cardId)',
    "                  event.dataTransfer.effectAllowed = 'move'",
    '                  // Firefox refuses to start a drag without payload.',
    "                  event.dataTransfer.setData('text/plain', item.cardId)",
    '                }}',
    '                onDragOver={(event) => {',
    '                  if (dragId === null) return',
    '                  event.preventDefault()',
    "                  event.dataTransfer.dropEffect = 'move'",
    '                  const index = slotUnder(event.clientX, event.clientY)',
    '                  if (index !== null && index !== dropIndex) setDropIndex(index)',
    '                }}',
    "                onDrop={(event) => {",
    '                  event.preventDefault()',
    '                  const index = dropIndex',
    '                  const moving = dragId',
    '                  endDrag()',
    '                  if (moving === null || index === null) return',
    '                  props.onReorder?.(moving, index)',
    '                }}',
    '                onDragEnd={endDrag}',
    '                onClick={() => { props.onOpenCard(item.cardId) }}',
  ]),
)

// ---- link chips, above the footer --------------------------------------
source = source.replace(
  J([
    "                <div className={styles['cardFooter']}>",
  ]),
  J([
    '                {item.links !== undefined && item.links.length > 0',
    '                  ? (',
    "                      <div className={styles['cardLinks']} data-mindmap-card-links={item.links.length}>",
    '                        {item.links.slice(0, 3).map(link => (',
    '                          <span',
    '                            key={(link.outgoing ? \'out-\' : \'in-\') + link.toCardId}',
    "                            className={styles['cardLinkChip']}",
    "                            data-mindmap-link={link.outgoing ? 'out' : 'in'}",
    '                            title={link.kind}',
    '                          >',
    "                            {link.outgoing ? '→ ' : '← '}{link.title}",
    '                          </span>',
    '                        ))}',
    '                      </div>',
    '                    )',
    '                  : null}',
    "                <div className={styles['cardFooter']}>",
  ]),
)

fs.writeFileSync(file, source, 'utf8')
console.log('drawer drag + links')
