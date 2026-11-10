/** Scope the corpus search by workspace cwd (drawer) or leave it global (header). */
import fs from 'node:fs'
const J = (lines) => lines.join('\n')

// ---- host: accept cwd ------------------------------------------------
let host = fs.readFileSync('lib/index.js', 'utf8')
const oldSig = 'runtime.search = async (query) => {'
if (!host.includes(oldSig)) {
  console.error('host signature not found')
  process.exit(1)
}
host = host.replace(oldSig, 'runtime.search = async (query, cwd) => {')
host = host.replace(
  'const page = await corpus.searchSessions({ query, limit: 10 }, { signal });',
  'const scoped = typeof cwd === "string" && cwd !== "";\n\t\t\t\tconst page = await corpus.searchSessions(\n\t\t\t\t\tscoped ? { query, limit: 10, filters: [{ kind: "cwd", values: [cwd] }] } : { query, limit: 10 },\n\t\t\t\t\t{ signal }\n\t\t\t\t);',
)
// route: pass cwd through
host = host.replace(
  `				if (route === "POST /mind-map/search") {
					const body = await readJsonBody(request);
					const query = typeof body?.query === "string" ? body.query.trim() : "";`,
  `				if (route === "POST /mind-map/search") {
					const body = await readJsonBody(request);
					const query = typeof body?.query === "string" ? body.query.trim() : "";
					const cwd = typeof body?.cwd === "string" ? body.cwd : "";`,
)
host = host.replace('const page = await runtime.search(query);', 'const page = await runtime.search(query, cwd);')
fs.writeFileSync('lib/index.js', host, 'utf8')

// ---- api -------------------------------------------------------------
let api = fs.readFileSync('src/client/api.ts', 'utf8')
api = api.replace(
  '  searchSessions(query: string): Promise<{',
  '  searchSessions(query: string, cwd?: string): Promise<{',
)
api = api.replace(
  "    return postJson('/mind-map/search', { query })",
  "    return postJson('/mind-map/search', cwd === undefined ? { query } : { query, cwd })",
)
fs.writeFileSync('src/client/api.ts', api, 'utf8')

// ---- rpc: cwd in the signature + cache key ---------------------------
let rpc = fs.readFileSync('src/client/rpc.ts', 'utf8')
rpc = rpc.replace(
  'export async function searchSessions(query: string): Promise<ContentHit[]> {\n  const key = query.trim().toLowerCase()',
  'export async function searchSessions(query: string, cwd?: string): Promise<ContentHit[]> {\n  const key = (cwd ?? \'\') + \'|\' + query.trim().toLowerCase()',
)
rpc = rpc.replace(
  '  const hits = await searchSessionsUncached(query)',
  '  const hits = await searchSessionsUncached(query, cwd)',
)
rpc = rpc.replace(
  'async function searchSessionsUncached(query: string): Promise<ContentHit[]> {',
  'async function searchSessionsUncached(query: string, cwd?: string): Promise<ContentHit[]> {',
)
rpc = rpc.replace(
  '    const page = await mindMapApi.searchSessions(query)',
  '    const page = await mindMapApi.searchSessions(query, cwd)',
)
fs.writeFileSync('src/client/rpc.ts', rpc, 'utf8')

console.log('cwd-scoped search wired')
