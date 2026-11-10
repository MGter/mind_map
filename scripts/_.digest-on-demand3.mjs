/**
 * Client side of the on-demand digest:
 *  • ensureDigest(): hash-aware regeneration (no LLM call when nothing changed)
 *  • 推送摘要 / 新建分支 both ensure first, then build the text from what came back
 *  • edge menu: 开启/关闭自动推送 (injection.autoPush)
 */
import fs from 'node:fs'

function patch(file, edits) {
  let source = fs.readFileSync(file, 'utf8')
  const EOL = source.includes('\r\n') ? '\r\n' : '\n'
  const before = source
  for (const [from, to] of edits) {
    const pattern = Array.isArray(from) ? from.join(EOL) : from
    const replacement = Array.isArray(to) ? to.join(EOL) : to
    if (!source.includes(pattern)) {
      console.error('  ! anchor missing in', file, '→', String(pattern).slice(0, 60))
      continue
    }
    source = source.replace(pattern, replacement)
  }
  if (source !== before) {
    fs.writeFileSync(file, source, 'utf8')
    console.log('  patched', file)
  }
}

// ---- 1. api: ensureDigest --------------------------------------------
patch('src/client/api.ts', [[
  ['  refreshDigest(sessionId: string): Promise<{ sessionId: string; digest: Digest }> {',
   "    return postJson('/mind-map/digest/refresh', { sessionId })",
   '  },'],
  ['  refreshDigest(sessionId: string): Promise<{ sessionId: string; digest: Digest }> {',
   "    return postJson('/mind-map/digest/refresh', { sessionId })",
   '  },',
   '  /**',
   '   * Regenerate ONLY if the conversation moved on: the Host hashes the',
   '   * transcript and hands back the stored digest when it is still current.',
   '   */',
   '  ensureDigest(sessionId: string): Promise<{ sessionId: string; digest: Digest }> {',
   "    return postJson('/mind-map/digest/ensure', { sessionId })",
   '  },'],
]])

// ---- 2. shared model: autoPush flag ----------------------------------
patch('src/shared/model.ts', [[
  ['  kind: \'digest\' | \'full\' | \'selection\' | \'none\' | \'link\'',
   '  injectedText?: string'],
  ['  kind: \'digest\' | \'full\' | \'selection\' | \'none\' | \'link\'',
   '  injectedText?: string',
   '  /**',
   '   * Push this card\'s digest to the edge\'s target whenever it changes.',
   '   * Off by default: digests are generated on demand only.',
   '   */',
   '  autoPush?: boolean'],
]])

// ---- 3. MapCanvas: push path ensures first ---------------------------
patch('src/client/MapCanvas.tsx', [[
  ['    const digest = canvasState.digests[fromCard.sessionId]',
   '    if (digest === undefined || digestIsEmpty(digest)) return',
   '    const fromTitle = sessions.byId[fromCard.sessionId]?.displayTitle ?? fromCard.sessionId',
   '    const toTitle = sessions.byId[toCard.sessionId]?.displayTitle ?? toCard.sessionId',
   '    try {',
   '      await mindMapApi.injectContext(toCard.sessionId, [',
   '        { sessionId: fromCard.sessionId, text: buildPushText(fromTitle, digest) },',
   '      ])'],
  ['    const fromTitle = sessions.byId[fromCard.sessionId]?.displayTitle ?? fromCard.sessionId',
   '    const toTitle = sessions.byId[toCard.sessionId]?.displayTitle ?? toCard.sessionId',
   '    try {',
   '      // The digest is not kept warm any more: refresh it here, but only when',
   '      // this conversation actually changed (the Host skips the LLM call).',
   '      const fresh = await mindMapApi.ensureDigest(fromCard.sessionId)',
   '      const digest = fresh.digest ?? canvasState.digests[fromCard.sessionId]',
   '      if (digest === undefined || digestIsEmpty(digest)) {',
   "        showToast(t('digest.empty'))",
   '        return',
   '      }',
   '      await mindMapApi.injectContext(toCard.sessionId, [',
   '        { sessionId: fromCard.sessionId, text: buildPushText(fromTitle, digest) },',
   '      ])'],
]])

// ---- 4. edge menu: auto push toggle ---------------------------------
patch('src/client/MapCanvas.tsx', [[
  ['      // Stored edges only — lineage lines are derived, nothing to persist on.'],
  ['      if (stored !== undefined) {',
   "        const auto = stored.injection.autoPush === true",
   '        items.push({',
   "          key: 'auto-push',",
   "          label: auto ? t('edge.autoPushOff') : t('edge.autoPushOn'),",
   "          ...(auto ? {} : { hint: t('edge.autoPushHint') }),",
   '          onPick: () => {',
   '            close()',
   '            canvas.addEdges({',
   '              [edgeId]: {',
   '                ...stored,',
   '                injection: { ...stored.injection, autoPush: !auto },',
   '              },',
   '            })',
   '          },',
   '        })',
   '      }',
   '      // Stored edges only — lineage lines are derived, nothing to persist on.'],
]])

console.log('client patched')
