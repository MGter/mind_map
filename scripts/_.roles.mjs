/** Role labels (你 / AI) + drop JSON-ish lines from snippets. */
import fs from 'node:fs'
const J = (lines) => lines.join('\n')

// ---- host: context only from conversation events; role per hit ---------
let host = fs.readFileSync('lib/index.js', 'utf8')
host = host.replace(
  'const events = [window?.target, ...(window?.events ?? [])].filter((event) => event !== void 0);',
  J([
    '// Only the conversation itself: a tool result or a document record is not',
    '// what the reader is looking for, and its JSON scaffolding is noise.',
    'const conversationEvents = new Set(["user/message", "assistant/message"]);',
    'const events = [window?.target, ...(window?.events ?? [])]',
    '\t\t\t\t\t.filter((event) => event !== void 0 && conversationEvents.has(String(event.type ?? "")));',
  ]),
)
// role on each search hit
host = host.replace(
  `					return {
						sessionId: header?.id ?? hit?.sessionId ?? "",
						blocks: line === "" ? [] : [[line]],
						seqs: [typeof best?.seq === "number" ? best.seq : null],
						...(subagent ? { agent: "subagent" } : {})
					};`,
  `					return {
						sessionId: header?.id ?? hit?.sessionId ?? "",
						blocks: line === "" ? [] : [[line]],
						seqs: [typeof best?.seq === "number" ? best.seq : null],
						roles: [best?.type === "user/message" ? "user" : "agent"],
						...(subagent ? { agent: "subagent" } : {})
					};`,
)
host = host.replace(
  `					blocks.push([snippet.split(/\\r?\\n/).map((part) => part.trim()).find((part) => part !== "") ?? ""]);
					seqs.push(typeof hit?.seq === "number" ? hit.seq : null);`,
  `					blocks.push([snippet.split(/\\r?\\n/).map((part) => part.trim()).find((part) => part !== "") ?? ""]);
					seqs.push(typeof hit?.seq === "number" ? hit.seq : null);
					roles.push(hit?.type === "user/message" ? "user" : "agent");`,
)
host = host.replace(
  `				const blocks = [];
				const seqs = [];
				for (const hit of events?.items ?? []) {`,
  `				const blocks = [];
				const seqs = [];
				const roles = [];
				for (const hit of events?.items ?? []) {`,
)
host = host.replace('				return { blocks, seqs };', '				return { blocks, seqs, roles };')
fs.writeFileSync('lib/index.js', host, 'utf8')

// ---- client: carry roles ----------------------------------------------
let rpc = fs.readFileSync('src/client/rpc.ts', 'utf8')
rpc = rpc.replace(
  '  /** Whose session this is: the conversation you had, or one an agent spawned. */',
  J([
    '  /** Per-match author: your message or the agent\'s answer. */',
    '  roles: (string | null)[]',
    '  /** Whose session this is: the conversation you had, or one an agent spawned. */',
  ]),
)
rpc = rpc.replace(
  '          seqs: blocks.map((_, index) => (typeof seqs[index] === \'number\' ? seqs[index] : null)),',
  J([
    '          seqs: blocks.map((_, index) => (typeof seqs[index] === \'number\' ? seqs[index] : null)),',
    '          roles: blocks.map((_, index) => (typeof roles[index] === \'string\' ? roles[index] : null)),',
  ]),
)
rpc = rpc.replace(
  '        const seqs = Array.isArray(item.seqs) ? item.seqs : []',
  '        const seqs = Array.isArray(item.seqs) ? item.seqs : []\n        const roles = Array.isArray(item.roles) ? item.roles : []',
)
rpc = rpc.replace(
  '        return { sessionId: item.sessionId, blocks: [], seqs: [], agent, depth }',
  '        return { sessionId: item.sessionId, blocks: [], seqs: [], roles: [], agent, depth }',
)
fs.writeFileSync('src/client/rpc.ts', rpc, 'utf8')

let shared = fs.readFileSync('src/client/SearchResults.tsx', 'utf8')
shared = shared.replace(
  '  seqs?: (number | null)[]',
  '  seqs?: (number | null)[]\n  /** Author of each match: your message or the agent\'s answer. */\n  roles?: (string | null)[]',
)
shared = shared.replace(
  '        const seqs = more[hit.sessionId]?.seqs ?? hit.seqs ?? []',
  '        const seqs = more[hit.sessionId]?.seqs ?? hit.seqs ?? []\n        const roles = hit.roles ?? []',
)
shared = shared.replace(
  J([
    '                  {renderMarkdownInline(line, props.query).nodes}',
  ]),
  J([
    '                  <span',
    "                    className={styles['drawerRoleChip']}",
    '                    data-mindmap-role={roles[index] ?? \'agent\'}',
    '                  >',
    "                    {roles[index] === 'user' ? t('stack.roleUser') : t('stack.roleAgent')}",
    '                  </span>',
    '                  {renderMarkdownInline(line, props.query).nodes}',
  ]),
)
fs.writeFileSync('src/client/SearchResults.tsx', shared, 'utf8')

// ---- cleaner: drop JSON-ish lines -------------------------------------
let snippet = fs.readFileSync('src/client/snippet-text.ts', 'utf8')
snippet = snippet.replace(
  '  return text === \'\' ? String(raw ?? \'\').trim() : text',
  J([
    '  // Lines that are pure scaffolding: an identifier, a key: value pair, a hash.',
    '  text = text',
    '    .split(/\\s{2,}|…/)',
    '    .filter((part) => {',
    '      const value = part.trim()',
    "      if (value === '') return false",
    '      if (/^[A-Za-z0-9_$.-]{1,40}$/.test(value)) return false',
    '      if (/^[A-Za-z0-9_$]{6,}\\s*:/.test(value) && value.length < 60) return false',
    '      if (/^[0-9a-f]{16,}$/i.test(value)) return false',
    '      return true',
    '    })',
    "    .join(' ')",
    '    .trim()',
    '',
    "  return text === '' ? String(raw ?? '').trim() : text",
  ]),
)
fs.writeFileSync('src/client/snippet-text.ts', snippet, 'utf8')

console.log('roles + cleaner')
