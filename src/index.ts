/**
 * mind_map host entry. Three independently-injected layers over one
 * shared store promise, so a composition missing llm or agents still serves
 * the board (spawn/digest routes answer 503 instead):
 *
 *   1. storageDomain + webServer  → mind_map domain + /mind-map/* routes
 *   2. sessionQuery + llm + agentDefaultModel + sessions → digest pipeline
 *   3. agents + sessionQuery      → injection-spawn
 *
 * Failure policy: a broken external plugin must not take the host down —
 * open/mount failures are logged and the affected layer stays inert.
 */
import type { DigestHostServices, SessionQueryService, SpawnHostServices, MindMapHostServices } from './host/dsh-host.ts'
import { DigestPipeline } from './host/digest/pipeline.ts'
import { mountMindMapRoutes, type MindMapRuntime } from './host/routes.ts'
import { Spawner } from './host/spawn.ts'
import { openMindMapStore, type MindMapStore } from './host/store.ts'

export const name = 'mind_map'

/** Structural cordis surface at the outer (uninjected) layer. */
interface OuterContext {
  logger?: { info?(message: string): void; warn(message: string): void }
  inject(deps: readonly string[], callback: (ctx: unknown) => void): void
}

export function apply(ctx: OuterContext): void {
  const runtime: MindMapRuntime = {}
  let resolveStore: (store: MindMapStore) => void
  let rejectStore: (error: unknown) => void
  const storeReady = new Promise<MindMapStore>((resolve, reject) => {
    resolveStore = resolve
    rejectStore = reject
  })
  storeReady.catch(() => { /* observed per-consumer; avoid unhandled rejection */ })

  // Layer 1: storage domain + HTTP routes.
  ctx.inject(['storageDomain', 'webServer'], (injected: unknown) => {
    const services = injected as MindMapHostServices
    services.effect(() => {
      let disposed = false
      let store: MindMapStore | undefined
      openMindMapStore(services.storageDomain).then((opened) => {
        if (disposed) {
          void opened.domain.close()
          return
        }
        store = opened
        resolveStore(opened)
        services.logger?.info?.('[mind_map] storage domain open, routes live at /mind-map/')
      }).catch((error) => {
        services.logger?.warn(`[mind_map] storage domain failed to open: ${String(error)}`)
        rejectStore(error)
      })
      const unmountRoutes = mountMindMapRoutes(services, storeReady, runtime)
      return () => {
        disposed = true
        unmountRoutes()
        void store?.domain.close()
      }
    }, 'mind_map: domain + routes')
  })

  // Layer 2: digest pipeline (needs the llm route and session surfaces).
  ctx.inject(['sessions', 'sessionQuery', 'sessionController', 'llm', 'agentDefaultModel'], (injected: unknown) => {
    const services = injected as DigestHostServices
    services.effect(() => {
      // Auto-sync is shelved: the pipeline's onFresh hook and
      // host/auto-sync.ts stay unwired until the feature is wanted.
      const pipeline = new DigestPipeline(services, storeReady)
      const stop = pipeline.start()
      runtime.digest = pipeline
    /**
     * Full-text search across every conversation, exposed to the drawer through
     * POST /mind-map/search (see routes.ts).
     *
     * Uses the corpus query service, not sessionController.search: the latter
     * is the API-domain wrapper and needs an owning Agent (it answers
     * SessionQueryError when the Host itself asks).
     */
    runtime.search = async (query: string) => {
      const corpus = (runtime as { sessionQuery?: { searchSessions: (r: { query: string; limit?: number }, e?: { signal?: AbortSignal }) => Promise<{ items?: unknown[]; nextCursor?: unknown }> } }).sessionQuery
      if (corpus === undefined) throw new Error('sessionQuery unavailable')
      const page = await corpus.searchSessions({ query, limit: 20 }, { signal: new AbortController().signal })
      const items = ((page.items ?? []) as { header?: { id?: string }; bestMatch?: { snippet?: string } }[])
        .map(hit => ({ sessionId: hit.header?.id ?? '', snippet: hit.bestMatch?.snippet ?? '' }))
        .filter(item => item.sessionId !== '')
      return { items, hasMore: page.nextCursor !== undefined }
    }
      // Backfill: cards already on the board whose session has no digest yet
      // (historic conversations never hit the turn/end trigger).
      void storeReady.then((store) => {
        if (runtime.digest !== pipeline) return
        const missing = [...new Set([...store.cards.entries()].map(([, card]) => card.sessionId))]
          .filter((sessionId) => {
            const digest = store.digests.get(sessionId)
            return digest === undefined || digest.summary === ''
          })
        pipeline.backfill(missing)
      }).catch(() => undefined)
      return () => {
        stop()
        if (runtime.digest === pipeline) delete runtime.digest
      }
    }, 'mind_map: digest pipeline')
  })

  // Defaults for the draft composer (each optional — missing service just
  // leaves the corresponding default unlabeled).
  ctx.inject(['agentDefaultModel'], (injected: unknown) => {
    const services = injected as { agentDefaultModel: { currentSelection(): { provider: string; model: string; reasoningEffort?: string } }; effect(cb: () => () => void, label?: string): void }
    services.effect(() => {
      runtime.modelDefault = () => services.agentDefaultModel.currentSelection()
      return () => { delete runtime.modelDefault }
    }, 'mind_map: model default')
  })
  // Card bodies read the user's last message straight off the session surface —
  // no LLM involved, so it is a separate injection from the digest pipeline.
  ctx.inject(['sessionQuery'], (injected: unknown) => {
    const services = injected as { sessionQuery: SessionQueryService; effect(cb: () => () => void, label?: string): void }
    services.effect(() => {
      runtime.sessionQuery = services.sessionQuery
      return () => {
        if (runtime.sessionQuery === services.sessionQuery) delete runtime.sessionQuery
      }
    }, 'mind_map: session query')
  })
  ctx.inject(['agentPresets'], (injected: unknown) => {
    const services = injected as { agentPresets: { defaultId: string }; effect(cb: () => () => void, label?: string): void }
    services.effect(() => {
      runtime.presetDefault = () => services.agentPresets.defaultId
      return () => { delete runtime.presetDefault }
    }, 'mind_map: preset default')
  })

  // Layer 3: injection-spawn (needs the agent registry).
  ctx.inject(['agents', 'sessionQuery', 'workspaceRegistry'], (injected: unknown) => {
    const services = injected as SpawnHostServices
    services.effect(() => {
      const spawner = new Spawner(services, storeReady)
      runtime.spawner = spawner
      return () => {
        if (runtime.spawner === spawner) delete runtime.spawner
      }
    }, 'mind_map: spawner')
  })
}
