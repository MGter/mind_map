/** Hover "peek": show the whole matched passage in a floating box. */
import fs from 'node:fs'

const file = 'src/client/StackDrawer.tsx'
let source = fs.readFileSync(file, 'utf8')
const J = (lines) => lines.join('\n')

// ---- state + handlers --------------------------------------------------
source = source.replace(
  '  const [searchError, setSearchError] = useState<string | null>(null)',
  J([
    '  const [searchError, setSearchError] = useState<string | null>(null)',
    '  /** The passage under the pointer, in a floating box (null = nothing). */',
    '  const [peek, setPeek] = useState<{ title: string; lines: string[]; x: number; y: number } | null>(null)',
    '  const peekTimer = useRef<number | null>(null)',
    '',
    '  const cancelPeek = (): void => {',
    '    if (peekTimer.current !== null) {',
    '      window.clearTimeout(peekTimer.current)',
    '      peekTimer.current = null',
    '    }',
    '    setPeek(null)',
    '  }',
    '',
    '  /** Wait a beat before showing it: a fast pass over the list stays quiet. */',
    '  const schedulePeek = (hit: DrawerSearchHit, block: string[], event: React.MouseEvent): void => {',
    '    if (peekTimer.current !== null) window.clearTimeout(peekTimer.current)',
    '    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()',
    '    peekTimer.current = window.setTimeout(() => {',
    '      peekTimer.current = null',
    '      setPeek({ title: hit.title, lines: block, x: rect.left, y: rect.bottom + 6 })',
    '    }, 180)',
    '  }',
    '',
    '  useEffect(() => cancelPeek, [])',
  ]),
)

// ---- popover markup ----------------------------------------------------
source = source.replace(
  '        </div>\n      </div>\n    </div>\n  )\n}',
  J([
    '        </div>',
    '        {peek !== null',
    '          ? (',
    '              <div',
    "                className={styles['peek']}",
    '                data-mindmap-search-peek=""',
    '                style={{',
    '                  left: Math.min(Math.max(12, peek.x), Math.max(12, window.innerWidth - 520)),',
    '                  top: Math.min(peek.y, Math.max(12, window.innerHeight - 220)),',
    '                }}',
    '                onMouseLeave={cancelPeek}',
    '              >',
    "                <div className={styles['peekTitle']}>{peek.title}</div>",
    '                {peek.lines.map((line, index) => (',
    "                  <div key={index} className={styles['peekLine']}>{highlight(line, query)}</div>",
    '                ))}',
    "                <div className={styles['peekHint']}>{t('stack.peekHint')}</div>",
    '              </div>',
    '            )',
    '          : null}',
    '      </div>',
    '    </div>',
    '  )',
    '}',
  ]),
)

fs.writeFileSync(file, source, 'utf8')
console.log('peek popover wired')
