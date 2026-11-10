/**
 * Digest becomes on-demand (indentation-agnostic version).
 */
import fs from 'node:fs'

const file = 'lib/index.js'
let source = fs.readFileSync(file, 'utf8')
const before = source
const J = (lines) => lines.join('\n')

// 1. default off
source = source.replace(/enabled: true,(\s*)idleMs: 3e4/, 'enabled: false,$1idleMs: 3e4')

// 2. gate on turn/end
source = source.replace(
  /^([ \t]*)if \(!this\.config\.enabled\) return;$/m,
  (match, indent) => J([
    `${indent}// Off by default: only sessions that feed an auto-push edge get digested,`,
    `${indent}// and even then the LLM call is skipped when nothing changed.`,
    `${indent}if (!this.config.enabled && !(this.config.shouldAuto?.(session.id) ?? false)) return;`,
  ]),
)

// 3. ensure()
source = source.replace(
  /([ \t]*)async refresh\(sessionId\) \{(\s*)return await this\.run\(sessionId, \{ force: true \}\);\2\}/,
  (match, indent, gap) => J([
    match,
    `${indent}/**`,
    `${indent} * Regenerate only if the conversation actually moved on: same`,
    `${indent} * transcript → the stored digest comes back untouched, no LLM call.`,
    `${indent} */`,
    `${indent}async ensure(sessionId) {`,
    `${indent}\treturn await this.run(sessionId, { force: false });`,
    `${indent}}`,
  ]),
)

// 4. route
source = source.replace(
  /([ \t]*)if \(route === "POST \/mind-map\/digest\/refresh"\) \{/,
  (match, indent) => J([
    `${indent}if (route === "POST /mind-map/digest/ensure") {`,
    `${indent}\tif (runtime.digest === void 0) {`,
    `${indent}\t\tsendJson(response, 503, { error: "digest layer unavailable (llm service missing)" });`,
    `${indent}\t\treturn;`,
    `${indent}\t}`,
    `${indent}\tconst ensureBody = refreshDigestBody.parse(await readJsonBody(request));`,
    `${indent}\tconst ensured = await runtime.digest.ensure(ensureBody.sessionId);`,
    `${indent}\tsendJson(response, 200, { sessionId: ensureBody.sessionId, digest: ensured });`,
    `${indent}\treturn;`,
    `${indent}}`,
    match,
  ]),
)

// 5. pipeline config + auto-push hook
const hook = J([
  '\t\t\t/** Host-side mirror of the client push text (digest-text.ts). */',
  '\t\t\tconst buildPushTextHost = (title, digest) => {',
  '\t\t\t\tconst now = new Date();',
  '\t\t\t\tconst stamp = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;',
  '\t\t\t\tconst body = [];',
  '\t\t\t\tif (digest?.summary) body.push(`摘要：${digest.summary}`);',
  '\t\t\t\tif (Array.isArray(digest?.keyFindings) && digest.keyFindings.length > 0) {',
  '\t\t\t\t\tbody.push("关键结论：");',
  '\t\t\t\t\tfor (const finding of digest.keyFindings) body.push(`- ${finding}`);',
  '\t\t\t\t}',
  '\t\t\t\tconst next = digest?.nextStep || digest?.todoNext || "";',
  '\t\t\t\tif (next !== "") body.push(`下一步：${next}`);',
  '\t\t\t\tbody.push(`【提醒】以上是摘要提纲，不是完整对话。需要细节（具体命令、参数、结论出处）时，请随时回到原会话「${title}」查看完整对话记录。`);',
  '\t\t\t\treturn [`【来自「${title}」的更新 · ${stamp}】`, ...body].join("\\n");',
  '\t\t\t};',
  '\t\t\t/** Sessions pulled from by at least one auto-push edge. */',
  '\t\t\tconst refreshAutoSources = async () => {',
  '\t\t\t\tconst store = await storeReady;',
  '\t\t\t\tconst set = new Set();',
  '\t\t\t\tfor (const edge of store.edges.values()) {',
  '\t\t\t\t\tif (edge?.injection?.autoPush !== true) continue;',
  '\t\t\t\t\tconst card = store.cards.get(edge.fromCardId);',
  '\t\t\t\t\tif (card !== void 0) set.add(card.sessionId);',
  '\t\t\t\t}',
  '\t\t\t\truntime.autoPushSessions = set;',
  '\t\t\t\treturn set;',
  '\t\t\t};',
  '\t\t\truntime.autoPushSessions = new Set();',
  '\t\t\tvoid refreshAutoSources();',
  '\t\t\tconst pipeline = new DigestPipeline(',
  '\t\t\t\tservices,',
  '\t\t\t\tstoreReady,',
  '\t\t\t\t{',
  '\t\t\t\t\t...DIGEST_DEFAULTS,',
  '\t\t\t\t\tshouldAuto: (sessionId) => runtime.autoPushSessions.has(sessionId),',
  '\t\t\t\t},',
  '\t\t\t\t/** Runs only when a digest really changed (hash differs). */',
  '\t\t\t\tasync (sessionId, digest) => {',
  '\t\t\t\t\tconst store = await storeReady;',
  '\t\t\t\t\tconst targets = [];',
  '\t\t\t\t\tfor (const edge of store.edges.values()) {',
  '\t\t\t\t\t\tif (edge?.injection?.autoPush !== true) continue;',
  '\t\t\t\t\t\tconst from = store.cards.get(edge.fromCardId);',
  '\t\t\t\t\t\tconst to = store.cards.get(edge.toCardId);',
  '\t\t\t\t\t\tif (from?.sessionId !== sessionId || to === void 0) continue;',
  '\t\t\t\t\t\ttargets.push(to.sessionId);',
  '\t\t\t\t\t}',
  '\t\t\t\t\tif (targets.length === 0) return;',
  '\t\t\t\t\tconst records = await services.sessionQuery.listSessions().catch(() => []);',
  '\t\t\t\t\tconst title = records.find((record) => record.header.id === sessionId)?.header.title ?? sessionId;',
  '\t\t\t\t\tconst text = buildPushTextHost(title, digest);',
  '\t\t\t\t\tfor (const target of targets) {',
  '\t\t\t\t\t\ttry {',
  '\t\t\t\t\t\t\tawait runtime.spawner.injectInto(target, [{ sessionId, text }]);',
  '\t\t\t\t\t\t\tservices.logger?.info?.(`[mind_map] auto-pushed digest → ${target}`);',
  '\t\t\t\t\t\t} catch (error) {',
  '\t\t\t\t\t\t\tservices.logger?.warn(`[mind_map] auto push failed: ${String(error)}`);',
  '\t\t\t\t\t\t}',
  '\t\t\t\t\t}',
  '\t\t\t\t},',
  '\t\t\t);',
])
const pipelineAnchor = /([ \t]*)const pipeline = new DigestPipeline\(services, storeReady\);/
if (!pipelineAnchor.test(source)) {
  console.error('pipeline anchor missing')
  process.exit(1)
}
source = source.replace(pipelineAnchor, hook)

if (source === before) {
  console.error('no change applied')
  process.exit(1)
}
fs.writeFileSync(file, source, 'utf8')
console.log('host patched')
