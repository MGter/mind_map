/** Rewrite the spawn/create calls onto the real RPC helpers. */
import fs from 'node:fs'

const spawnFile = 'src/client/SpawnPreview.tsx'
let spawn = fs.readFileSync(spawnFile, 'utf8')

spawn = spawn.replace(
  "import { closeMapPanel, connectionApi, forkSessionInUi, getServices, mapUi, openSessionInUi } from './map-state.ts'",
  "import { closeMapPanel, forkSessionInUi, getServices, mapUi, openSessionInUi } from './map-state.ts'\nimport { callRpc } from './rpc.ts'",
)

// unwrap() is obsolete once the RPC helper unwraps for us.
spawn = spawn.replace(
  `function unwrap<T>(response: { result: { ok: true; value: T } | { ok: false; error: { code?: string; message?: string } } }, what: string): T {
  const { result } = response
  if (result.ok) return result.value
  throw new Error(\`\${what}: \${result.error.code ?? ''} \${result.error.message ?? ''}\`.trim())
}

`,
  '',
)

spawn = spawn.replace(
  `      const api = connectionApi()
      if (api === undefined) throw new Error(t('spawn.apiUnavailable'))
      if (mode === 'digest') {`,
  `      const createSession = async (): Promise<{ sessionId: string }> => callRpc<{ sessionId: string }>(
        'session/create',
        pending.parentWorkspaceId !== undefined ? { workspaceId: pending.parentWorkspaceId } : {},
      )
      if (mode === 'digest') {`,
)

spawn = spawn.replace(
  `        const created = unwrap(await api.sessions.create(
          pending.parentWorkspaceId !== undefined ? { workspaceId: pending.parentWorkspaceId } : {},
        ), 'session.create')
        await mindMapApi.injectContext(created.sessionId, [`,
  `        const created = await createSession()
        await mindMapApi.injectContext(created.sessionId, [`,
)

spawn = spawn.replace(
  `      const created = unwrap(await api.sessions.create(
        pending.parentWorkspaceId !== undefined ? { workspaceId: pending.parentWorkspaceId } : {},
      ), 'session.create')
      addCardAndEdge(created.sessionId, 'none')
      unwrap(await api.sessions.prompt({
        sessionId: created.sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: firstMessage }],
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }), 'session.prompt')`,
  `      const created = await createSession()
      addCardAndEdge(created.sessionId, 'none')
      await callRpc('session/prompt', {
        sessionId: created.sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: firstMessage }],
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })`,
)

fs.writeFileSync(spawnFile, spawn, 'utf8')

const canvasFile = 'src/client/MapCanvas.tsx'
let canvas = fs.readFileSync(canvasFile, 'utf8')
canvas = canvas.replace(
  `            const api = connectionApi()
            if (api === undefined) throw new Error(t('spawn.apiUnavailable'))
            const path = \`\${parentDir}/\${value}\`
            await mindMapApi.ensureDir(path)
            const response = await api.workspace.create({ path })
            if (!response.result.ok) {
              throw new Error(\`workspace.create: \${response.result.error.message ?? response.result.error.code ?? ''}\`)
            }
            importWorkspace(response.result.value.workspace.workspaceId, menu.flowX, menu.flowY)`,
  `            const path = \`\${parentDir}/\${value}\`
            await mindMapApi.ensureDir(path)
            const created = await callRpc<{ workspace: { workspaceId: string } }>('workspace/create', { path })
            importWorkspace(created.workspace.workspaceId, menu.flowX, menu.flowY)`,
)
if (!canvas.includes("from './rpc.ts'")) {
  canvas = canvas.replace(
    "import { sessionAlerts } from './session-alerts.ts'",
    "import { callRpc } from './rpc.ts'\nimport { sessionAlerts } from './session-alerts.ts'",
  )
}
fs.writeFileSync(canvasFile, canvas, 'utf8')
console.log('spawn + workspace creation now use the real RPC')
