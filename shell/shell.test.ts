import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createStore } from '../reader/store'
import { createPrefs } from './prefs'
import { CH, buildPreloadApi, splitInput, toPublicSettings, toSessionsPayload, type Prefs } from './api'

const SECRET = 'clave-super-secreta-123'
const P0: Prefs = { colors: {}, launchAtLogin: false, setupDone: false }

function fakeIpc() {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => void>()
  return {
    handlers,
    invoke: vi.fn(async (ch: string) => (ch === CH.getSessions ? null : { hasKey: true })),
    on: vi.fn((ch: string, fn: (e: unknown, ...a: unknown[]) => void) => void handlers.set(ch, fn)),
    removeListener: vi.fn((ch: string) => void handlers.delete(ch)),
  }
}

describe('API del preload', () => {
  it('no incluye la clave: ni en los nombres ni en lo que devuelve', () => {
    const api = buildPreloadApi(fakeIpc())
    expect(Object.keys(api).sort()).toEqual(['clearKey', 'getAccounts', 'getSettings', 'onSessions', 'saveSettings'])
    expect(Object.keys(api).some(k => /key|clave/i.test(k) && k !== 'clearKey')).toBe(false)
  })

  it('los ajustes públicos solo dicen si hay clave (hasKey), nunca cuál', () => {
    const pub = toPublicSettings(
      { relayUrl: 'https://x.workers.dev', relayKey: SECRET, pcName: 'PC1', aliases: {}, idleMs: 1, closedMs: 2 },
      P0,
    )
    expect(pub.hasKey).toBe(true)
    expect(JSON.stringify(pub)).not.toContain(SECRET)
    expect(Object.keys(pub)).not.toContain('relayKey')
  })

  it('onSessions entrega los datos del canal y se puede desuscribir', () => {
    const ipc = fakeIpc()
    const cb = vi.fn()
    const off = buildPreloadApi(ipc).onSessions(cb)
    const payload = { sessions: [], colors: {} }
    ipc.handlers.get(CH.sessions)!({}, payload)
    expect(cb).toHaveBeenCalledWith(payload)
    off()
    expect(ipc.handlers.has(CH.sessions)).toBe(false)
  })
})

describe('splitInput (lo que llega del renderer)', () => {
  it('clave vacía = no tocar la clave guardada', () => {
    const r = splitInput({ relayKey: '  ', pcName: 'Mi PC!' }, P0)
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect('relayKey' in r.settings).toBe(false)
    expect(r.settings.pcName).toBe('Mi-PC')
  })
  it('rechaza URL con credenciales o protocolo raro, acepta https y quita barra final', () => {
    expect('error' in splitInput({ relayUrl: 'ftp://x' }, P0)).toBe(true)
    expect('error' in splitInput({ relayUrl: 'https://u:p@x.dev' }, P0)).toBe(true)
    const ok = splitInput({ relayUrl: 'https://x.workers.dev/' }, P0)
    expect('error' in ok ? null : ok.settings.relayUrl).toBe('https://x.workers.dev')
    const none = splitInput({ relayUrl: '' }, P0)
    expect('error' in none ? 1 : 'relayUrl' in none.settings && none.settings.relayUrl).toBeUndefined()
  })
  it('descarta alias con rutas/emails y colores inválidos', () => {
    const r = splitInput(
      { aliases: { '0123456789abcdef': 'Cuenta A', '0123456789abcde0': 'a@b.com', zz: 'X' }, colors: { 'Cuenta A': '#ff0000', Otra: 'rojo' } },
      P0,
    )
    if ('error' in r) throw new Error(r.error)
    expect(r.settings.aliases).toEqual({ '0123456789abcdef': 'Cuenta A' })
    expect(r.prefs.colors).toEqual({ 'Cuenta A': '#ff0000' })
  })
})

describe('mapeo IPC de sesiones', () => {
  const snap = (id: string, account: string) => ({ id, pc: 'PC1', account, project: 'p', status: 'working' as const, updatedAt: 1 })
  it('ordena por id, copia (no comparte objetos) y asigna color por alias', () => {
    const src = [snap('b', 'Cuenta B'), snap('a', 'Cuenta A')]
    const out = toSessionsPayload(src, { ...P0, colors: { 'Cuenta B': '#123456' } })
    expect(out.sessions.map(s => s.id)).toEqual(['a', 'b'])
    expect(out.sessions[0]).not.toBe(src[1])
    expect(out.colors['Cuenta B']).toBe('#123456')
    expect(out.colors['Cuenta A']).toMatch(/^#[0-9a-f]{6}$/)
  })
  it('el payload solo lleva las claves permitidas del snapshot', () => {
    const out = toSessionsPayload([snap('a', 'Cuenta A')], P0)
    expect(Object.keys(out.sessions[0]!).sort()).toEqual(['account', 'id', 'pc', 'project', 'status', 'updatedAt'])
  })
})

describe('persistencia', () => {
  it('store y prefs escriben solo dentro de dataDir (y guardan la clave ahí)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ofi-shell-'))
    const dataDir = path.join(root, 'userData')
    try {
      const store = createStore(dataDir)
      const prefs = createPrefs(dataDir)
      store.set({ relayUrl: 'https://x.dev', relayKey: SECRET, pcName: 'PC1' })
      prefs.set({ colors: { 'Cuenta A': '#ff0000' }, launchAtLogin: true, setupDone: true })
      expect(fs.readdirSync(root)).toEqual(['userData'])
      expect(fs.readdirSync(dataDir).sort()).toEqual(['prefs.json', 'settings.json'])
      expect(store.get().relayKey).toBe(SECRET)
      expect(prefs.get()).toEqual({ colors: { 'Cuenta A': '#ff0000' }, launchAtLogin: true, setupDone: true })
      // la clave no se coló en las prefs
      expect(fs.readFileSync(path.join(dataDir, 'prefs.json'), 'utf8')).not.toContain(SECRET)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
  it('prefs ausentes o corruptas vuelven a defaults', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ofi-shell-'))
    try {
      expect(createPrefs(dir).get().setupDone).toBe(false)
      fs.writeFileSync(path.join(dir, 'prefs.json'), '{roto')
      expect(createPrefs(dir).get()).toEqual({ colors: {}, launchAtLogin: false, setupDone: false })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
