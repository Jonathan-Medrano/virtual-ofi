import { deriveStatus } from '../core/state'
import { toSnapshot, type SessionSnapshot } from '../core/identity'
import { sanitizeSnapshot } from '../core/privacy'
import { scanSessions } from './scan'
import type { Settings } from './store'

export const HEARTBEAT_MS = 30_000
export const BACKOFF_START_MS = 1_000
export const BACKOFF_MAX_MS = 5 * 60_000
const REQUEST_TIMEOUT_MS = 8_000

export type SyncDeps = {
  projectsDir: string
  store: { get(): Settings }
  now: () => number
  fetch: typeof fetch
  pcName: string
}

export function createSync(deps: SyncDeps) {
  let lastKey: string | null = null // lo último enviado con éxito
  let lastPutAt = -Infinity
  let backoff = 0 // 0 = relay sano
  let nextAttemptAt = 0

  async function buildLocal(now: number, s: Settings): Promise<SessionSnapshot[]> {
    const raw = await scanSessions(deps.projectsDir, now)
    const out: SessionSnapshot[] = []
    for (const r of raw) {
      const status = deriveStatus(r.records, now, { idleMs: s.idleMs, closedMs: s.closedMs })
      const snap = sanitizeSnapshot(
        toSnapshot(
          { sessionId: r.sessionId, folderName: r.folderName, accountUuid: r.accountUuid, status, updatedAt: r.lastActivity },
          { pc: deps.pcName, aliases: s.aliases },
        ),
      )
      if (snap) out.push(snap)
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : 1))
  }

  async function call(url: string, key: string, init: { method: string; body?: string }): Promise<Response> {
    const res = await deps.fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${key}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res
  }

  async function tick(): Promise<SessionSnapshot[]> {
    const now = deps.now()
    const s = deps.store.get()
    const local = await buildLocal(now, s)
    if (!s.relayUrl || !s.relayKey) return local
    if (now < nextAttemptAt) return local

    const base = s.relayUrl.replace(/\/+$/, '') + '/state'
    const key = JSON.stringify(local)
    try {
      if (key !== lastKey || now - lastPutAt >= HEARTBEAT_MS) {
        await call(base, s.relayKey, { method: 'PUT', body: JSON.stringify({ pc: deps.pcName, sessions: local }) })
        lastKey = key
        lastPutAt = now
      }
      const res = await call(base, s.relayKey, { method: 'GET' })
      const body = (await res.json()) as { sessions?: unknown }
      const remote: SessionSnapshot[] = []
      if (Array.isArray(body?.sessions)) {
        for (const item of body.sessions) {
          const snap = sanitizeSnapshot(item)
          if (snap && snap.pc !== deps.pcName) remote.push(snap) // lo local manda sobre lo remoto de esta PC
        }
      }
      if (backoff > 0) console.warn('[ofi] relay disponible de nuevo')
      backoff = 0
      nextAttemptAt = 0
      return [...remote, ...local]
    } catch {
      // Solo se registra un aviso genérico, sin el error (podría traer la URL o la cabecera con la clave).
      if (backoff === 0) console.warn('[ofi] relay no disponible: se muestra solo lo local y se reintenta')
      backoff = backoff === 0 ? BACKOFF_START_MS : Math.min(backoff * 2, BACKOFF_MAX_MS)
      nextAttemptAt = now + backoff
      return local
    }
  }

  return { tick }
}
