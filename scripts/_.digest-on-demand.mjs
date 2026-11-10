/**
 * Digest becomes on-demand:
 *  • no per-turn generation by default (DIGEST_DEFAULTS.enabled = false)
 *  • POST /mind-map/digest/ensure — regenerates ONLY when the transcript changed
 *    (the pipeline's own sha256 skip), used by push / spawn
 *  • auto push stays available, per edge: turn/end only queues sessions that are
 *    the source of an edge with injection.autoPush === true
 */
import fs from 'node:fs'

const file = 'lib/index.js'
let source = fs.readFileSync(file, 'utf8')
const before = source
const J = (lines) => lines.join('\n')

// 1. default off --------------------------------------------------------
source = source.replace(
  'enabled: true,\n\t\tidleMs: 3e4',
  'enabled: false,\n\t\tidleMs: 3e4',
)
if (source === before) {
  console.error('DIGEST_DEFAULTS shape not matched')
  process.exit(1)
}

// 2. turn/end gate: also run when an auto-push edge asks for it ---------
source = source.replace(
  '\t\t\tif (!this.config.enabled) return;',
  J([
    '\t\t\t// Off by default: only sessions that feed an auto-push edge are digested,',
    '\t\t\t// and even then the pipeline skips the LLM call when nothing changed.',
    '\t\t\tif (!this.config.enabled && !(this.config.shouldAuto?.(session.id) ?? false)) return;',
  ]),
)

// 3. ensure(): hash-aware regeneration ---------------------------------
source = source.replace(
  '\tasync refresh(sessionId) {\n\t\treturn await this.run(sessionId, { force: true });\n\t}',
  J([
    '\tasync refresh(sessionId) {',
    '\t\treturn await this.run(sessionId, { force: true });',
    '\t}',
    '\t/**',
    '\t * Regenerate only if the conversation actually moved on. Same transcript →',
    '\t * the stored digest is returned untouched, no LLM call.',
    '\t */',
    '\tasync ensure(sessionId) {',
    '\t\treturn await this.run(sessionId, { force: false });',
    '\t}',
  ]),
)

// 4. route --------------------------------------------------------------
source = source.replace(
  '\t\t\t\tif (route === "POST /mind-map/digest/refresh") {',
  J([
    '\t\t\t\tif (route === "POST /mind-map/digest/ensure") {',
    '\t\t\t\t\tif (runtime.digest === void 0) {',
    '\t\t\t\t\t\tsendJson(response, 503, { error: "digest layer unavailable (llm service missing)" });',
    '\t\t\t\t\t\treturn;',
    '\t\t\t\t\t}',
    '\t\t\t\t\tconst ensureBody = refreshDigestBody.parse(await readJsonBody(request));',
    '\t\t\t\t\tconst ensured = await runtime.digest.ensure(ensureBody.sessionId);',
    '\t\t\t\t\tsendJson(response, 200, { sessionId: ensureBody.sessionId, digest: ensured });',
    '\t\t\t\t\treturn;',
    '\t\t\t\t}',
    '\t\t\t\tif (route === "POST /mind-map/digest/refresh") {',
  ]),
)

// 5. pipeline: pass config + the auto-push hook -------------------------
source = source.replace(
  '\t\t\tconst pipeline = new DigestPipeline(services, storeReady);',
  J([
    '\t\t\t/**',
    '\t\t\t * Host-side mirror of the client push text (digest-text.ts).',
    '\t\t\t * Keep the wording in sync: the same paragraph is what people read.',
    '\t\t\t */',
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
    '\t\t\t/** Sessions that at least one auto-push edge pulls from. */',
    '\t\t\truntime.autoPushSources = async () => {',
    '\t\t\t\tconst store = await storeReady;',
    '\t\t\t\tconst sessions = new Set();',
    '\t\t\t\tfor (const edge of store.edges.values()) {',
    '\t\t\t\t\tif (edge?.injection?.autoPush !== true) continue;',
    '\t\t\t\t\tconst card = store.cards.get(edge.fromCardId);',
    '\t\t\t\t\tif (card !== void 0) sessions.add(card.sessionId);',
    '\t\t\t\t}',
    '\t\t\t\treturn sessions;',
    '\t\t\t};',
    '\t\t\tconst pipeline = new DigestPipeline(',
    '\t\t\t\tservices,',
    '\t\t\t\tstoreReady,',
    '\t\t\t\t{',
    '\t\t\t\t\t...DIGEST_DEFAULTS,',
    '\t\t\t\t\tshouldAuto: (sessionId) => runtime.autoPushSessions?.has(sessionId) === true,',
    '\t\t\t\t},',
    '\t\t\t\t/** Called only when a digest actually changed (hash differs). */',
    '\t\t\t\tasync (sessionId, digest) => {',
    '\t\t\t\t\tconst store = await storeReady;',
    '\t\t\t\t\tconst targets = [];',
    '\t\t\t\t\tfor (const [edgeId, edge] of Object.entries(store.edges.entries ? Object.fromEntries(store.edges.entries()) : {})) {',
    '\t\t\t\t\t\tif (edge?.injection?.autoPush !== true) continue;',
    '\t\t\t\t\t\tconst from = store.cards.get(edge.fromCardId);',
    '\t\t\t\t\t\tconst to = store.cards.get(edge.toCardId);',
    '\t\t\t\t\t\tif (from?.sessionId !== sessionId || to === void 0) continue;',
    '\t\t\t\t\t\ttargets.push({ edgeId, toSessionId: to.sessionId });',
    '\t\t\t\t\t}',
    '\t\t\t\t\tif (targets.length === 0) return;',
    '\t\t\t\t\tconst records = await services.sessionQuery.listSessions().catch(() => []);',
    '\t\t\t\t\tconst title = records.find((record) => record.header.id === sessionId)?.header.title ?? sessionId;',
    '\t\t\t\t\tconst text = buildPushTextHost(title, digest);',
    '\t\t\t\t\tfor (const target of targets) {',
    '\t\t\t\t\t\ttry {',
    '\t\t\t\t\t\t\tawait runtime.spawner.injectInto(target.toSessionId, [{ sessionId, text }]);',
    '\t\t\t\t\t\t\tservices.logger?.info?.(`[mind_map] auto-pushed digest ${edgeId} → ${target.toSessionId}`);',
    '\t\t\t\t\t\t} catch (error) {',
    '\t\t\t\t\t\t\tservices.logger?.warn(`[mind_map] auto push ${edgeId} failed: ${String(error)}`);',
    '\t\t\t\t\t\t}',
    '\t\t\t\t\t}',
    '\t\t\t\t},',
    '\t\t\t);',
    '\t\t\t// Cache of sessions an auto-push edge reads from (refreshed on demand).',
    '\t\t\truntime.autoPushSessions = new Set();',
    '\t\t\tvoid runtime.autoPushSources().then((set) => { runtime.autoPushSessions = set; });',
  ]),
)

if (source === before) {
  console.error('no change applied')
  process.exit(1)
}
fs.writeFileSync(file, source, 'utf8')
console.log('host: digest on-demand + per-edge auto push')
