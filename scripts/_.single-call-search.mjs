/** Host: search = ONE corpus call. Per-session extra hits move to a second route. */
import fs from 'node:fs'

const file = 'lib/index.js'
const lines = fs.readFileSync(file, 'utf8').split('\n')
const start = lines.findIndex(line => line.includes('runtime.search = async (query) => {'))
if (start < 0) {
  console.error('runtime.search not found')
  process.exit(1)
}
let blockStart = start
while (blockStart > 0 && lines[blockStart - 1].trim().startsWith('*')) blockStart -= 1
while (blockStart > 0 && lines[blockStart - 1].trim() === '/**') blockStart -= 1
// find the end: the line that closes the assignment ("};" at the same indentation)
let end = start
while (end < lines.length && !(lines[end].trim() === '};' && lines[end].startsWith('\t\t\t}'))) end += 1
if (end >= lines.length) {
  console.error('end not found')
  process.exit(1)
}

const block = `\t\t\t/**
\t\t\t * One corpus query, nothing else. Measured on the real corpus: a search that
\t\t\t * also ran searchEvents per session took 12-15 s; this form just returns the
\t\t\t * best match the index already computed. Extra hits inside one conversation
\t\t\t * are fetched by /mind-map/search-session when the user asks for them.
\t\t\t */
\t\t\truntime.search = async (query) => {
\t\t\t\tconst corpus = runtime.sessionQuery;
\t\t\t\tif (corpus === void 0) throw new Error("sessionQuery unavailable");
\t\t\t\tconst signal = new AbortController().signal;
\t\t\t\tconst page = await corpus.searchSessions({ query, limit: 10 }, { signal });
\t\t\t\tconst items = (page?.items ?? []).map((hit) => {
\t\t\t\t\tconst best = hit?.bestMatch;
\t\t\t\t\tconst snippet = typeof best?.snippet === "string" ? best.snippet.trim() : "";
\t\t\t\t\tconst line = snippet.split(/\\r?\\n/).map((part) => part.trim()).find((part) => part !== "") ?? "";
\t\t\t\t\treturn {
\t\t\t\t\t\tsessionId: hit?.header?.id ?? hit?.sessionId ?? "",
\t\t\t\t\t\tblocks: line === "" ? [] : [[line]],
\t\t\t\t\t\tseqs: [typeof best?.seq === "number" ? best.seq : null]
\t\t\t\t\t};
\t\t\t\t}).filter((item) => item.sessionId !== "" && item.blocks.length > 0);
\t\t\t\treturn { items, hasMore: page?.nextCursor !== void 0 };
\t\t\t};
\t\t\t/** Every extra hit inside ONE conversation (asked for explicitly). */
\t\t\truntime.searchSession = async (sessionId, query) => {
\t\t\t\tconst corpus = runtime.sessionQuery;
\t\t\t\tif (corpus === void 0) throw new Error("sessionQuery unavailable");
\t\t\t\tconst signal = new AbortController().signal;
\t\t\t\tconst events = await corpus.searchEvents({ sessionId, query, limit: 6 }, { signal });
\t\t\t\tconst blocks = [];
\t\t\t\tconst seqs = [];
\t\t\t\tfor (const hit of events?.items ?? []) {
\t\t\t\t\tconst snippet = typeof hit?.snippet === "string" ? hit.snippet.trim() : "";
\t\t\t\t\tif (snippet === "") continue;
\t\t\t\t\tblocks.push([snippet.split(/\\r?\\n/).map((part) => part.trim()).find((part) => part !== "") ?? ""]);
\t\t\t\t\tseqs.push(typeof hit?.seq === "number" ? hit.seq : null);
\t\t\t\t}
\t\t\t\treturn { blocks, seqs };
\t\t\t};`

const next = [...lines.slice(0, blockStart), block, ...lines.slice(end + 1)]
fs.writeFileSync(file, next.join('\n'), 'utf8')
console.log(`replaced ${blockStart + 1}..${end + 1}`)
