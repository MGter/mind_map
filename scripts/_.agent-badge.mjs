/** Mark each search hit as main-agent or sub-agent session. */
import fs from 'node:fs'
const J = (lines) => lines.join('\n')

// ---- host: carry the session origin ------------------------------------
let host = fs.readFileSync('lib/index.js', 'utf8')
const oldHost = `				const items = (page?.items ?? []).map((hit) => {
					const best = hit?.bestMatch;
					const snippet = typeof best?.snippet === "string" ? best.snippet.trim() : "";
					const line = snippet.split(/\\r?\\n/).map((part) => part.trim()).find((part) => part !== "") ?? "";
					return {
						sessionId: hit?.header?.id ?? hit?.sessionId ?? "",
						blocks: line === "" ? [] : [[line]],
						seqs: [typeof best?.seq === "number" ? best.seq : null]
					};
				}).filter((item) => item.sessionId !== "" && item.blocks.length > 0);`
const newHost = `				const items = (page?.items ?? []).map((hit) => {
					const best = hit?.bestMatch;
					const snippet = typeof best?.snippet === "string" ? best.snippet.trim() : "";
					const line = snippet.split(/\\r?\\n/).map((part) => part.trim()).find((part) => part !== "") ?? "";
					const header = hit?.header ?? {};
					// A sub-agent session is the one a tool/agent spawned: the header
					// says so (origin) and carries its delegation depth.
					const subagent = header?.origin === "subagent"
						|| typeof header?.delegationDepth === "number"
						|| header?.parentSession !== void 0;
					return {
						sessionId: header?.id ?? hit?.sessionId ?? "",
						blocks: line === "" ? [] : [[line]],
						seqs: [typeof best?.seq === "number" ? best.seq : null],
						agent: subagent ? "subagent" : "main",
						depth: typeof header?.delegationDepth === "number" ? header.delegationDepth : 0
					};
				}).filter((item) => item.sessionId !== "" && item.blocks.length > 0);`
if (!host.includes(oldHost)) {
  console.error('host search block not found')
  process.exit(1)
}
host = host.replace(oldHost, newHost)
fs.writeFileSync('lib/index.js', host, 'utf8')

// ---- client api type ---------------------------------------------------
let api = fs.readFileSync('src/client/api.ts', 'utf8')
api = api.replace(
  "    items: { sessionId: string; blocks?: string[][]; seqs?: (number | null)[]; lines?: string[]; snippet?: string }[]",
  "    items: { sessionId: string; blocks?: string[][]; seqs?: (number | null)[]; agent?: string; depth?: number; lines?: string[]; snippet?: string }[]",
)
fs.writeFileSync('src/client/api.ts', api, 'utf8')

// ---- rpc: ContentHit.agent -------------------------------------------
let rpc = fs.readFileSync('src/client/rpc.ts', 'utf8')
rpc = rpc.replace(
  '  /** Event seq per match, so the passage can be pulled on demand. */\n  seqs: (number | null)[]',
  J([
    '  /** Event seq per match, so the passage can be pulled on demand. */',
    '  seqs: (number | null)[]',
    '  /** Whose session this is: the conversation you had, or one an agent spawned. */',
    "  agent: 'main' | 'subagent'",
    '  /** How deep in the delegation chain a sub-agent session sits. */',
    '  depth: number',
  ]),
)
rpc = rpc.replace(
  `    items: readonly {
      sessionId?: string
      blocks?: string[][]
      seqs?: (number | null)[]
      lines?: string[]
      snippet?: string
    }[] | undefined,`,
  `    items: readonly {
      sessionId?: string
      blocks?: string[][]
      seqs?: (number | null)[]
      agent?: string
      depth?: number
      lines?: string[]
      snippet?: string
    }[] | undefined,`,
)
rpc = rpc.replace(
  `        const withSeqs = (blocks: string[][]): ContentHit => ({
          sessionId: item.sessionId,
          blocks,
          seqs: blocks.map((_, index) => (typeof seqs[index] === 'number' ? seqs[index] : null)),
        })`,
  `        const agent: 'main' | 'subagent' = item.agent === 'subagent' ? 'subagent' : 'main'
        const depth = typeof item.depth === 'number' ? item.depth : 0
        const withSeqs = (blocks: string[][]): ContentHit => ({
          sessionId: item.sessionId,
          blocks,
          seqs: blocks.map((_, index) => (typeof seqs[index] === 'number' ? seqs[index] : null)),
          agent,
          depth,
        })`,
)
rpc = rpc.replace(
  "        return { sessionId: item.sessionId, blocks: [], seqs: [] }",
  "        return { sessionId: item.sessionId, blocks: [], seqs: [], agent, depth }",
)
fs.writeFileSync('src/client/rpc.ts', rpc, 'utf8')

// ---- MapCanvas: pass agent/depth -------------------------------------
let canvas = fs.readFileSync('src/client/MapCanvas.tsx', 'utf8')
canvas = canvas.replace(
  '                  seqs: hit.seqs,\n                }))',
  J([
    '                  seqs: hit.seqs,',
    '                  agent: hit.agent,',
    '                  depth: hit.depth,',
    '                }))',
  ]),
)
fs.writeFileSync('src/client/MapCanvas.tsx', canvas, 'utf8')

// ---- drawer: chip + type ---------------------------------------------
let drawer = fs.readFileSync('src/client/StackDrawer.tsx', 'utf8')
drawer = drawer.replace(
  '  /** Event seq per block, when the Host supplied one. */\n  seqs?: (number | null)[]',
  J([
    '  /** Event seq per block, when the Host supplied one. */',
    '  seqs?: (number | null)[]',
    "  /** Main conversation, or one an agent spawned. */",
    "  agent?: 'main' | 'subagent'",
    '  depth?: number',
  ]),
)
drawer = drawer.replace(
  J([
    '                      <button',
    '                        type="button"',
    "                        className={styles['drawerHitTitle']}",
    '                        onClick={() => { props.onOpenSession?.(hit.sessionId) }}',
    '                      >',
    '                        {highlight(hit.title, query)}',
    '                      </button>',
  ]),
  J([
    '                      <div className={styles[\'drawerHitHead\']}>',
    '                        <span',
    '                          className={`${styles[\'drawerAgentChip\']} ${hit.agent === \'subagent\' ? styles[\'drawerAgentChipSub\'] : \'\'}`}',
    '                          data-mindmap-agent={hit.agent ?? \'main\'}',
    '                          title={hit.agent === \'subagent\' ? t(\'stack.agentSubHint\') : t(\'stack.agentMainHint\')}',
    '                        >',
    '                          {hit.agent === \'subagent\'',
    '                            ? t(\'stack.agentSub\')',
    '                            : t(\'stack.agentMain\')}',
    '                        </span>',
    '                        <button',
    '                          type="button"',
    "                          className={styles['drawerHitTitle']}",
    '                          onClick={() => { props.onOpenSession?.(hit.sessionId) }}',
    '                        >',
    '                          {highlight(hit.title, query)}',
    '                        </button>',
    '                      </div>',
  ]),
)
fs.writeFileSync('src/client/StackDrawer.tsx', drawer, 'utf8')

console.log('agent badge wired')
