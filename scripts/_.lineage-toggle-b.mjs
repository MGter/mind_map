/**
 * Lineage lines: selectable + hideable.
 *
 * Nobody draws these — they are derived from fork/subagent provenance — and being
 * `selectable: false` they could not be inspected or removed, so they read as
 * mystery wiring. Now: right-click explains what it is and offers 隐藏血缘线; the
 * canvas menu brings it back. The choice is remembered.
 */
import fs from 'node:fs'

const file = 'src/client/MapCanvas.tsx'
let source = fs.readFileSync(file, 'utf8')
const EOL = source.includes('\r\n') ? '\r\n' : '\n'
const J = (lines) => lines.join(EOL)

// ---- 1. preference state ----------------------------------------------
const stateAnchor = J([
  '  /** Bumped after a push: edges recompute their sync state (lineage has no edge row). */',
  '  const [pushEpoch, setPushEpoch] = useState(0)',
])
if (!source.includes(stateAnchor)) {
  console.error('state anchor missing')
  process.exit(1)
}
source = source.replace(
  stateAnchor,
  J([
    stateAnchor,
    '  /** Lineage lines (fork/subagent provenance) can be switched off entirely. */',
    "  const LINEAGE_KEY = 'dsh.mind_map.lineage-hidden.v1'",
    '  const [lineageHidden, setLineageHiddenState] = useState(() => {',
    '    try {',
    "      return localStorage.getItem('dsh.mind_map.lineage-hidden.v1') === '1'",
    '    } catch {',
    '      return false',
    '    }',
    '  })',
    '  const setLineageHidden = (next: boolean): void => {',
    '    setLineageHiddenState(next)',
    '    try {',
    "      localStorage.setItem('dsh.mind_map.lineage-hidden.v1', next ? '1' : '0')",
    '    } catch { /* private mode: the choice lasts this session */ }',
    '  }',
  ]),
)

// ---- 2. stop painting them when hidden --------------------------------
const lineageLoop = J([
  '    for (const [cardId, card] of Object.entries(visibleCards)) {',
  '      if (foldedSet.has(cardId)) continue',
  '      const parentSessionId = sessions.byId[card.sessionId]?.parentId',
])
if (!source.includes(lineageLoop)) {
  console.error('lineage loop anchor missing')
  process.exit(1)
}
source = source.replace(
  lineageLoop,
  J([
    '    if (!lineageHidden) {',
    '    for (const [cardId, card] of Object.entries(visibleCards)) {',
    '      if (foldedSet.has(cardId)) continue',
    '      const parentSessionId = sessions.byId[card.sessionId]?.parentId',
  ]),
)
source = source.replace(
  J([
    '        style: { strokeDasharray: \'6 4\', opacity: 0.5 },',
    '      })',
    '    }',
    '    return out',
  ]),
  J([
    '        style: { strokeDasharray: \'6 4\', opacity: 0.5 },',
    '      })',
    '    }',
    '    }',
    '    return out',
  ]),
)
source = source.replace(
  '  }, [visibleCards, canvasState.edges, sessions, sessionIdToCardId, liveSelectedEdgeIds, foldedSet, locale, pushEpoch])',
  '  }, [visibleCards, canvasState.edges, sessions, sessionIdToCardId, liveSelectedEdgeIds, foldedSet, locale, pushEpoch, lineageHidden])',
)

// ---- 3. selectable, so the menu can explain it ------------------------
source = source.replace(
  J([
    '        type: \'smoothstep\',',
    '        selectable: false,',
    '        className: `tmEdge tmEdge-${lineageSync}`',
  ]),
  J([
    '        type: \'smoothstep\',',
    '        // Selectable on purpose: right-clicking it must answer "what is this",',
    '        // and offer to hide it. It used to be un-clickable mystery wiring.',
    '        className: `tmEdge tmEdge-${lineageSync}`',
  ]),
)

// ---- 4. edge menu: explain + hide -------------------------------------
const menuAnchor = J([
  '      items.push({',
  "        key: 'push',",
  "        label: t('edge.push'),",
])
if (!source.includes(menuAnchor)) {
  console.error('menu anchor missing')
  process.exit(1)
}
source = source.replace(
  menuAnchor,
  J([
    '      if (stored === undefined) {',
    '        // A derived lineage line: nothing to push along, nothing to delete.',
    '        items.push({',
    "          key: 'lineage-info',",
    "          label: t('edge.lineageTitle'),",
    "          hint: t('edge.lineageHint'),",
    '          disabled: true,',
    '        })',
    '        items.push({',
    "          key: 'hide-lineage',",
    "          label: t('edge.hideLineage'),",
    '          onPick: () => {',
    '            close()',
    '            setLineageHidden(true)',
    '          },',
    '        })',
    '      }',
    menuAnchor,
  ]),
)

// ---- 5. canvas menu: bring them back ---------------------------------
const paneAnchor = J([
  "      items.push({",
  "        key: 'import-ws',",
])
if (!source.includes(paneAnchor)) {
  console.error('pane anchor missing')
  process.exit(1)
}
source = source.replace(
  paneAnchor,
  J([
    '      items.push({',
    "        key: 'toggle-lineage',",
    "        label: lineageHidden ? t('edge.showLineage') : t('edge.hideLineage'),",
    '        onPick: () => {',
    '          close()',
    '          setLineageHidden(!lineageHidden)',
    '        },',
    '      })',
    paneAnchor,
  ]),
)

fs.writeFileSync(file, source, 'utf8')
console.log('lineage toggle wired')
