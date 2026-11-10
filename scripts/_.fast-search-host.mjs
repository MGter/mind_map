/** Host: fast search (no per-hit log reads) + a lazy context route for hover. */
import fs from 'node:fs'

const file = 'lib/index.js'
const lines = fs.readFileSync(file, 'utf8').split('\n')

// ---- replace runtime.search -------------------------------------------
const start = lines.findIndex(line => line.includes('runtime.search = async (query) => {'))
if (start < 0) {
  console.error('runtime.search not found')
  process.exit(1)
}
let blockStart = start
while (blockStart > 0 && lines[blockStart - 1].trim().startsWith('*')) blockStart -= 1
while (blockStart > 0 && lines[blockStart - 1].trim() === '/**') blockStart -= 1
let end = start
while (end < lines.length && !lines[end].trim().startsWith('};')) end += 1

const searchBlock = `\t\t\t/**
\t\t\t * Full-text search, FAST: one index query per conversation, no log reads.
\t\t\t * Each hit keeps its \`seq\` so the drawer can pull the surrounding passage
\t\t\t * only when the pointer rests on that line (see /mind-map/search-context).
\t\t\t */
\t\t\truntime.search = async (query) => {
\t\t\t\tconst corpus = runtime.sessionQuery;
\t\t\t\tif (corpus === void 0) throw new Error("sessionQuery unavailable");
\t\t\t\tconst signal = new AbortController().signal;
\t\t\t\tconst page = await corpus.searchSessions({ query, limit: 10 }, { signal });
\t\t\t\tconst matched = (page?.items ?? [])
\t\t\t\t\t.map((hit) => ({ id: hit?.header?.id ?? hit?.sessionId ?? "", best: hit?.bestMatch?.snippet ?? "" }))
\t\t\t\t\t.filter((entry) => entry.id !== "");
\t\t\t\t// One round trip per conversation, run in parallel: the old version did a
\t\t\t\t// log read per hit and took ten seconds on a real corpus.
\t\t\t\tconst items = (await Promise.all(matched.map(async (entry) => {
\t\t\t\t\ttry {
\t\t\t\t\t\tconst events = await corpus.searchEvents({ sessionId: entry.id, query, limit: 3 }, { signal });
\t\t\t\t\t\tconst blocks = [];
\t\t\t\t\t\tconst seqs = [];
\t\t\t\t\t\tfor (const hit of events?.items ?? []) {
\t\t\t\t\t\t\tconst snip = typeof hit?.snippet === "string" ? hit.snippet.trim() : "";
\t\t\t\t\t\t\tif (snip === "") continue;
\t\t\t\t\t\t\tblocks.push(snip.split(/\\r?\\n/).filter((line) => line.trim() !== "").slice(0, 1));
\t\t\t\t\t\t\tseqs.push(typeof hit?.seq === "number" ? hit.seq : null);
\t\t\t\t\t\t}
\t\t\t\t\t\tif (blocks.length === 0 && typeof entry.best === "string" && entry.best.trim() !== "") {
\t\t\t\t\t\t\tblocks.push([entry.best.trim()]);
\t\t\t\t\t\t\tseqs.push(null);
\t\t\t\t\t\t}
\t\t\t\t\t\treturn blocks.length > 0 ? { sessionId: entry.id, blocks, seqs } : null;
\t\t\t\t\t} catch {
\t\t\t\t\t\treturn entry.best.trim() === ""
\t\t\t\t\t\t\t? null
\t\t\t\t\t\t\t: { sessionId: entry.id, blocks: [[entry.best.trim()]], seqs: [null] };
\t\t\t\t\t}
\t\t\t\t}))).filter((item) => item !== null);
\t\t\t\treturn { items, hasMore: page?.nextCursor !== void 0 };
\t\t\t};
\t\t\t/**
\t\t\t * The passage around one hit: the matched line plus up to three lines each
\t\t\t * way. Read on demand (hover), because reading a session log is expensive.
\t\t\t */
\t\t\truntime.searchContext = async (sessionId, seq, query) => {
\t\t\t\tconst corpus = runtime.sessionQuery;
\t\t\t\tif (corpus === void 0) throw new Error("sessionQuery unavailable");
\t\t\t\tconst signal = new AbortController().signal;
\t\t\t\tconst window = await corpus.readEvent({ sessionId, seq, before: 2, after: 2 }, signal);
\t\t\t\tconst text = textOfBlocks(window?.target?.data?.message?.content ?? "");
\t\t\t\tconst trimmed = String(text ?? "").trim();
\t\t\t\tif (trimmed === "") return { lines: [] };
\t\t\t\tconst all = trimmed.split(/\\r?\\n/);
\t\t\t\tconst wanted = String(query ?? "").toLowerCase();
\t\t\t\tlet index = all.findIndex((line) => line.toLowerCase().includes(wanted));
\t\t\t\tif (index < 0) index = 0;
\t\t\t\tconst from = Math.max(0, index - 3);
\t\t\t\tconst to = Math.min(all.length - 1, index + 3);
\t\t\t\tconst lines = all.slice(from, to + 1).map((line) => {
\t\t\t\t\tconst value = line.trim();
\t\t\t\t\tif (value.length <= 320) return value;
\t\t\t\t\tconst at = Math.max(0, value.toLowerCase().indexOf(wanted));
\t\t\t\t\treturn (at > 120 ? "…" : "") + value.slice(Math.max(0, at - 120), at + 160) + "…";
\t\t\t\t}).filter((line) => line !== "");
\t\t\t\treturn { lines };
\t\t\t};`

const next = [...lines.slice(0, blockStart), searchBlock, ...lines.slice(end + 1)]
fs.writeFileSync(file, next.join('\n'), 'utf8')
console.log('runtime.search rewritten + searchContext added')
