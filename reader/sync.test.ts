import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSync } from './sync'
import { createStore } from './store'
import { ALLOWED_SNAPSHOT_KEYS } from '../core/privacy'
import type { SessionSnapshot } from '../core/identity'

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'core', 'fixtures')
const T0 = Date.parse('2026-10-16T12:00:30.000Z')
const KEY = 'clave-secreta-de-prueba-123'
let dir: string, projects: string, data: string
let clock: number

const fixture = (n: string) => fs.readFileSync(path.join(FIX, n), 'utf8')
function put(folder: string, file: string, content: string) {
  const d = path.join(projects, folder)
  fs.mkdirSync(d, { recursive: true })
  const p = path.join(d, file)
  fs.writeFileSync(p, content)
  const t = (clock - 1000) / 1000
  fs.utimesSync(p, t, t)
}

type Call = { url: string; method: string; headers: Record<string, string>; body?: string }
function mockFetch(opts: { fail?: () => boolean; remote?: unknown[] } = {}) {
  const calls: Call[] = []
  const f = vi.fn(async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body })
    // el error incluye la clave a propósito: el lector no debe loguearlo
    if (opts.fail?.()) throw new Error('boom ' + (init.headers?.Authorization ?? ''))
    if ((init.method ?? 'GET') === 'PUT') return { ok: true, status: 200, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => ({ sessions: opts.remote ?? [] }) }
  })
  return { f, calls }
}

function make(fetchImpl: unknown, configured = true, pcName = 'PC-A') {
  const store = createStore(data)
  store.set({ pcName, ...(configured ? { relayUrl: 'https://relay.example/', relayKey: KEY } : {}) })
  return createSync({ projectsDir: projects, store, now: () => clock, fetch: fetchImpl as typeof fetch, pcName })
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ofi-sync-'))
  projects = path.join(dir, 'projects'); data = path.join(dir, 'data')
  fs.mkdirSync(projects); fs.mkdirSync(data)
  clock = T0
  put('C--Users-Ana-Desktop-uno', 'a.jsonl', fixture('working.jsonl'))
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks() })

const puts = (c: Call[]) => c.filter(x => x.method === 'PUT')
const remoteSnap = (over: Partial<SessionSnapshot> = {}): SessionSnapshot =>
  ({ id: 'r1', pc: 'PC-B', account: 'Beto', project: 'otro', status: 'working', updatedAt: T0, ...over })

describe('sync', () => {
  it('sync_pushes_on_change_only', async () => {
    const m = mockFetch()
    const s = make(m.f)
    await s.tick()
    expect(puts(m.calls)).toHaveLength(1)
    clock += 5000
    await s.tick()
    expect(puts(m.calls)).toHaveLength(1)
    put('C--Users-Ana-Desktop-uno', 'a.jsonl', fixture('turn_end.jsonl'))
    clock += 5000
    await s.tick()
    expect(puts(m.calls)).toHaveLength(2)
    expect(puts(m.calls)[0].url).toBe('https://relay.example/state')
    expect(puts(m.calls)[0].headers.Authorization).toBe('Bearer ' + KEY)
  })

  it('sync_heartbeat_after_30s', async () => {
    const m = mockFetch()
    const s = make(m.f)
    await s.tick()
    clock += 29_000
    await s.tick()
    expect(puts(m.calls)).toHaveLength(1)
    clock += 2_000
    await s.tick()
    expect(puts(m.calls)).toHaveLength(2)
  })

  it('sync_falls_back_to_local_on_failure', async () => {
    const m = mockFetch({ fail: () => true })
    const r = await make(m.f).tick()
    expect(r).toHaveLength(1)
    expect(r[0].pc).toBe('PC-A')
    expect(r[0].project).toBe('uno')
    expect(r[0].account).toBe('Cuenta sin alias')
  })

  it('backoff_grows_and_resets', async () => {
    let failing = true
    const m = mockFetch({ fail: () => failing })
    const s = make(m.f)
    await s.tick()                       // falla -> espera 1 s
    const n1 = m.calls.length
    clock += 500; await s.tick()
    expect(m.calls.length).toBe(n1)      // dentro de la espera: no intenta
    clock += 600; await s.tick()         // pasó 1 s: reintenta, falla -> espera 2 s
    const n2 = m.calls.length
    expect(n2).toBeGreaterThan(n1)
    clock += 1500; await s.tick()
    expect(m.calls.length).toBe(n2)      // 2 s todavía no
    clock += 600; await s.tick()
    const n3 = m.calls.length
    expect(n3).toBeGreaterThan(n2)       // espera ahora 4 s
    clock += 3500; await s.tick()
    expect(m.calls.length).toBe(n3)
    for (let i = 0; i < 20; i++) { clock += 10 * 60_000; await s.tick() }
    const before = m.calls.length
    clock += 4 * 60_000; await s.tick()
    expect(m.calls.length).toBe(before)  // tope 5 min: a los 4 min todavía no
    failing = false
    clock += 2 * 60_000; await s.tick()  // vuelve el relay: primer éxito reinicia
    expect(m.calls.length).toBeGreaterThan(before)
    failing = true
    clock += 31_000; await s.tick()      // falla de nuevo -> espera 1 s otra vez
    const n4 = m.calls.length
    clock += 1100; await s.tick()
    expect(m.calls.length).toBeGreaterThan(n4)
  })

  it('merges_other_pcs', async () => {
    const stale = remoteSnap({ id: 'old', pc: 'PC-A', project: 'viejo-de-mi-pc' })
    const m = mockFetch({ remote: [remoteSnap(), stale, { id: 'x', ruta: 'C:/secreto' }] })
    const r = await make(m.f).tick()
    expect(r.find(x => x.id === 'r1')?.account).toBe('Beto')
    expect(r.find(x => x.id === 'old')).toBeUndefined()   // lo local manda sobre lo remoto de la misma PC
    expect(r.filter(x => x.pc === 'PC-A')).toHaveLength(1)
    expect(r).toHaveLength(2)                             // lo inválido se descarta
  })

  it('no_relay_configured_is_local_only', async () => {
    const m = mockFetch()
    const r = await make(m.f, false).tick()
    expect(m.f).not.toHaveBeenCalled()
    expect(r).toHaveLength(1)
  })

  it('request_body_has_only_allowed_keys', async () => {
    const m = mockFetch()
    await make(m.f).tick()
    const raw = puts(m.calls)[0].body!
    const body = JSON.parse(raw)
    expect(Object.keys(body).sort()).toEqual(['pc', 'sessions'])
    expect(body.pc).toBe('PC-A')
    expect(body.sessions).toHaveLength(1)
    for (const s of body.sessions) expect(Object.keys(s).sort()).toEqual([...ALLOWED_SNAPSHOT_KEYS].sort())
    expect(raw).not.toMatch(/Users|Ana|00000000-0000|sess-0001/)
    expect(m.calls.find(c => c.method === 'GET')?.body).toBeUndefined()
  })

  it('store_never_logs_key', async () => {
    const m = mockFetch({ fail: () => true })
    const s = make(m.f)
    for (let i = 0; i < 4; i++) { await s.tick(); clock += 400_000 }
    const all = [console.log, console.warn, console.error]
      .flatMap(f => (f as unknown as { mock: { calls: unknown[][] } }).mock.calls)
    expect(JSON.stringify(all)).not.toContain(KEY)
    expect(JSON.stringify(all)).not.toContain('Bearer')
    expect(all.length).toBeLessThanOrEqual(4)
  })
})
