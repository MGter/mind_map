/**
 * Lineage lines look like mystery wiring: nobody drew them, and because they were
 * `selectable: false` they could not even be inspected or removed — a dashed line
 * with no explanation.
 *
 * Fix: make them selectable (so the context menu answers "what is this"), add a
 * hide switch in that menu, and a matching toggle on the canvas menu that brings
 * them back. The choice is remembered across sessions.
 */
import fs from 'node:fs'

const file = 'src/client/MapCanvas.tsx'
let source = fs.readFileSync(file, 'utf8')
const EOL = source.includes('\r\n') ? '\r\n' : '\n'
const J = (lines) => lines.join(EOL)

// ---- 1. the preference -------------------------------------------------
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
    '  /** Lineage lines (fork/subagent provenance) can be switched off. */',
    "  const LINEAGE_KEY = 'dsh.mind-map.lineage-hidden.v1'",
    '  const [lineageHidden, setLineageHiddenState] = useState(() => {',
    '    try {',
    '      return localStorage.getItem(LINEAGE_KEY) === \'1\'',
    '    } catch {',
    '      return false',
    '    }',
    '  })',
    '  const setLineageHidden = (next: boolean): void => {',
    '    setLineageHiddenState(next)',
    '    try {',
    '      localStorage.setItem(LINEAGE_KEY, next ? \'1\' : \'0\')',
    '    } catch { /* private mode: the choice lasts this session */ }',
    '  }',
  ].replace(LINEAGE_KEY_PLACEHOLDER, '')),
)

fs.writeFileSync(file, source, 'utf8')
console.log('step1 done')
