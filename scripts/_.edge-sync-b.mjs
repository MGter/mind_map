/** Wire edge sync: stamp pushes, colour + animate the line. */
import fs from 'node:fs'

const file = 'src/client/MapCanvas.tsx'
let source = fs.readFileSync(file, 'utf8')
const EOL = source.includes('\r\n') ? '\r\n' : '\n'
const J = (lines) => lines.join(EOL)

// ---- 1. import ---------------------------------------------------------
source = source.replace(
  "import { buildPushText, digestIsEmpty } from './digest-text.ts'",
  "import { buildPushText, digestIsEmpty } from './digest-text.ts'" + EOL + "import { edgeSyncState } from './edge-sync.ts'",
)

// ---- 2. push stamps the edge ------------------------------------------
const pushAnchor = J([
  '      await mindMapApi.injectContext(toCard.sessionId, [',
  '        { sessionId: fromCard.sessionId, text: buildPushText(fromTitle, digest) },',
  '      ])',
  '      showToast(t(\'toast.pushed\', { to: toTitle }))',
])
if (!source.includes(pushAnchor)) {
  console.error('push anchor missing')
  process.exit(1)
}
source = source.replace(
  pushAnchor,
  J([
  '      await mindMapApi.injectContext(toCard.sessionId, [',
  '        { sessionId: fromCard.sessionId, text: buildPushText(fromTitle, digest) },',
  '      ])',
  '      // Remember when this line last delivered: "synced" is decided from it.',
  '      const pushedAt = Date.now()',
  '      for (const [id, edge] of Object.entries(canvasState.edges)) {',
  '        const same = (edge.fromCardId === fromCardId && edge.toCardId === toCardId)',
  '          || (edge.fromCardId === toCardId && edge.toCardId === fromCardId)',
  '        if (!same) continue',
  '        canvas.addEdges({ [id]: { ...edge, lastPushAt: pushedAt } })',
  '      }',
  '      showToast(t(\'toast.pushed\', { to: toTitle }))',
  ]),
)

// ---- 3. the line carries its state -------------------------------------
source = source.replace(
  J([
    '      const kind = edge.injection.kind',
    '      out.push({',
  ]),
  J([
    '      const kind = edge.injection.kind',
    '      // Does this line still carry the source\'s latest context?',
    '      const sync = edgeSyncState({',
    '        kind,',
    '        ...(typeof edge.lastPushAt === \'number\' ? { lastPushAt: edge.lastPushAt } : {}),',
    '        ...(sourceCardUpdatedAt(edge.fromCardId) !== undefined',
    '          ? { sourceUpdatedAt: sourceCardUpdatedAt(edge.fromCardId) }',
    '          : {}),',
    '      })',
    '      out.push({',
    '        // Read by the stylesheet: flow while synced, amber when behind, red',
    '        // when far behind. Classes beat inline styles for keyframes.',
    '        className: `tmEdge tmEdge-${sync}`',
  ]),
)

// ---- 4. marker colour follows the state -------------------------------
source = source.replace(
  J([
    '        markerEnd: {',
    '          type: MarkerType.ArrowClosed,',
    "          width: kind === 'link' ? 13 : 16,",
    "          height: kind === 'link' ? 13 : 16,",
    "          color: kind === 'link' ? 'rgba(255, 255, 255, 0.5)' : 'rgba(255, 214, 106, 0.85)',",
    '        },',
  ]),
  J([
    '        markerEnd: {',
    '          type: MarkerType.ArrowClosed,',
    "          width: kind === 'link' ? 13 : 16,",
    "          height: kind === 'link' ? 13 : 16,",
    '          color: sync === \'far\'',
    "            ? 'rgba(242, 78, 78, 0.9)'",
    "            : sync === 'stale'",
    "              ? 'rgba(255, 214, 106, 0.95)'",
    "              : kind === 'link' ? 'rgba(255, 255, 255, 0.5)' : 'rgba(255, 214, 106, 0.85)',",
    '        },',
  ]),
)

// ---- 5. helper: the source card's session freshness --------------------
const helperAnchor = J(['  const liveEdges = useMemo<Edge[]>(() => {'])
if (!source.includes(helperAnchor)) {
  console.error('liveEdges anchor missing')
  process.exit(1)
}
source = source.replace(
  helperAnchor,
  J([
    '  /** `updatedAt` of the session behind a card (undefined when it is gone). */',
    '  const sourceCardUpdatedAt = (cardId: string): number | undefined => {',
    '    const card = canvasState.cards[cardId]',
    '    if (card === undefined) return undefined',
    '    return sessions.byId[card.sessionId]?.updatedAt',
    '  }',
    '',
    helperAnchor,
  ]),
)

fs.writeFileSync(file, source, 'utf8')
console.log('canvas: edge sync wired')
