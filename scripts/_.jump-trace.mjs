/** Title search (client-side, we already have every title) + jump diagnostics. */
import fs from 'node:fs'
const J = (lines) => lines.join('\n')

// ---- jump: record what actually happened, and report it to the host log --
let jump = fs.readFileSync('src/client/jump-highlight.ts', 'utf8')
jump = jump.replace(
  "const MARK_CLASS = 'tm_search_flash'",
  J([
    "const MARK_CLASS = 'tm_search_flash'",
    '',
    '/** Steps of the last jump, so a failure can be read from the host log. */',
    'interface JumpTrace {',
    '  query: string',
    '  panelGone: boolean | null',
    '  findAttempts: number',
    '  found: boolean',
    '  insidePanel: boolean | null',
    '  matched: string | null',
    '  findAvailable: boolean',
    '}',
    '',
    'const trace: JumpTrace = {',
    '  query: \'\', panelGone: null, findAttempts: 0, found: false,',
    '  insidePanel: null, matched: null, findAvailable: false,',
    '}',
    '',
    'function report(): void {',
    '  try {',
    '    void fetch(\'/mind-map/client-boot\', {',
    '      method: \'POST\',',
    "      headers: { 'content-type': 'application/json' },",
    "      body: JSON.stringify({ phase: 'jump-debug', ...trace }),",
    '    }).catch(() => {})',
    '  } catch { /* nothing to do */ }',
    '}',
  ]),
)
jump = jump.replace(
  '  for (let attempt = 0; attempt < 12; attempt += 1) {',
  J([
    '  trace.findAvailable = typeof finder === \'function\'',
    '  for (let attempt = 0; attempt < 12; attempt += 1) {',
    '    trace.findAttempts += 1',
  ]),
)
jump = jump.replace(
  '    if (found !== true) return null',
  J([
    '    if (found !== true) return null',
    '    const selection = window.getSelection()',
    '    trace.insidePanel = insideOurPanel()',
    '    trace.matched = selection === null ? null : String(selection).slice(0, 60)',
  ]),
)
jump = jump.replace(
  'export function flashInTranscript(query: string): void {\n  const needle = query.trim().toLowerCase()\n  if (needle.length < 2) return',
  J([
    'export function flashInTranscript(query: string): void {',
    '  const needle = query.trim().toLowerCase()',
    '  if (needle.length < 2) return',
    '  trace.query = needle',
    '  trace.findAttempts = 0',
    '  trace.found = false',
    '  trace.insidePanel = null',
    '  trace.matched = null',
  ]),
)
jump = jump.replace(
  '    const viaFind = findInTranscript(needle)\n    if (viaFind !== null) {\n      flash(viaFind)\n      return\n    }',
  J([
    '    const viaFind = findInTranscript(needle)',
    '    if (viaFind !== null) {',
    '      trace.found = true',
    '      report()',
    '      flash(viaFind)',
    '      return',
    '    }',
  ]),
)
jump = jump.replace(
  '    waited += 200\n    if (waited > deadline) return',
  J([
    '    waited += 200',
    '    if (waited > deadline) {',
    '      report()',
    '      return',
    '    }',
  ]),
)
jump = jump.replace(
  '    if (document.querySelector(\'[class*="tm_panel"]\') !== null && waited < 2000) {',
  J([
    '    trace.panelGone = document.querySelector(\'[class*="tm_panel"]\') === null',
    '    if (document.querySelector(\'[class*="tm_panel"]\') !== null && waited < 2000) {',
  ]),
)
fs.writeFileSync('src/client/jump-highlight.ts', jump, 'utf8')

// ---- title hits, next to the content hits ------------------------------
let shared = fs.readFileSync('src/client/SearchResults.tsx', 'utf8')
shared = shared.replace(
  '  /** Author of each match: your message or the agent\'s answer. */\n  roles?: (string | null)[]',
  J([
    '  /** Author of each match: your message or the agent\'s answer. */',
    '  roles?: (string | null)[]',
    '  /** This conversation matched by TITLE, not content. */',
    '  byTitle?: boolean',
  ]),
)
shared = shared.replace(
  J([
    '              {hit.agent === \'subagent\'',
  ]),
  J([
    '              {hit.byTitle === true',
    '                ? (',
    "                    <span className={styles['drawerAgentChip']} data-mindmap-title-hit=\"1\">{t('stack.titleHit')}</span>",
    '                  )',
    '                : null}',
    '              {hit.agent === \'subagent\'',
  ]),
)
fs.writeFileSync('src/client/SearchResults.tsx', shared, 'utf8')

console.log('jump diagnostics + title badge')
