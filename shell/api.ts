// Lógica pura de la cáscara (sin importar electron: se prueba con vitest). Acá se decide QUÉ cruza el puente
// entre el proceso principal y la ventana. Regla: la clave del relay entra, pero NUNCA vuelve a salir.
import type { SessionSnapshot } from '../core/identity'
import type { Settings } from '../reader/store'

export const CH = {
  sessions: 'ofi:sessions',
  getSessions: 'ofi:get-sessions',
  getSettings: 'ofi:get-settings',
  saveSettings: 'ofi:save-settings',
  clearKey: 'ofi:clear-key',
  getAccounts: 'ofi:get-accounts',
} as const

export type Prefs = {
  /** Color (#rrggbb) por alias de cuenta. */
  colors: Record<string, string>
  launchAtLogin: boolean
  /** true cuando el usuario ya pasó (o saltó) la pantalla de primera vez. */
  setupDone: boolean
}

/** Lo que ve el renderer de los ajustes: sin clave, solo si hay una. */
export type PublicSettings = {
  relayUrl: string
  hasKey: boolean
  pcName: string
  aliases: Record<string, string>
  colors: Record<string, string>
  launchAtLogin: boolean
  setupDone: boolean
}

/** Lo que el renderer puede pedir guardar. `relayKey` vacío/ausente = no tocar la clave. */
export type SettingsInput = {
  relayUrl?: string
  relayKey?: string
  pcName?: string
  aliases?: Record<string, string>
  colors?: Record<string, string>
  launchAtLogin?: boolean
  setupDone?: boolean
}

export type Account = { id: string; alias: string; color: string }

export type SessionsPayload = { sessions: SessionSnapshot[]; colors: Record<string, string> }

export const DEFAULT_COLORS = ['#e8533f', '#3fa7e8', '#6cc24a', '#e8c13f']

export function toPublicSettings(s: Settings, p: Prefs): PublicSettings {
  return {
    relayUrl: s.relayUrl ?? '',
    hasKey: !!s.relayKey,
    pcName: s.pcName,
    aliases: { ...s.aliases },
    colors: { ...p.colors },
    launchAtLogin: p.launchAtLogin,
    setupDone: p.setupDone,
  }
}

const textOk = (v: string) => v.length > 0 && v.length <= 24 && !/[\/:@\\]/.test(v)
const colorOk = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)

/** undefined = sin relay; null = inválida; string = URL normalizada. */
export function cleanUrl(raw: string): string | undefined | null {
  const t = raw.trim()
  if (!t) return undefined
  try {
    const u = new URL(t)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    if (u.username || u.password) return null // credenciales en la URL: no
    return u.origin + u.pathname.replace(/\/+$/, '')
  } catch {
    return null
  }
}

/** Valida lo que llega del renderer (no se confía en él) y lo parte en parches para el store y las prefs. */
export function splitInput(
  input: SettingsInput,
  currentPrefs: Prefs,
): { settings: Partial<Settings>; prefs: Prefs } | { error: string } {
  const settings: Partial<Settings> = {}
  const prefs: Prefs = { ...currentPrefs, colors: { ...currentPrefs.colors } }
  if (input.relayUrl !== undefined) {
    const u = cleanUrl(String(input.relayUrl))
    if (u === null) return { error: 'La dirección del relay no es válida (tiene que empezar con https://).' }
    settings.relayUrl = u
  }
  if (typeof input.relayKey === 'string' && input.relayKey.trim()) settings.relayKey = input.relayKey.trim()
  if (typeof input.pcName === 'string') {
    const n = input.pcName.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)
    if (n) settings.pcName = n
  }
  if (input.aliases && typeof input.aliases === 'object') {
    const al: Record<string, string> = {}
    for (const [k, v] of Object.entries(input.aliases)) {
      const t = typeof v === 'string' ? v.trim() : ''
      if (/^[0-9a-f]{16}$/.test(k) && textOk(t)) al[k] = t
    }
    settings.aliases = al
  }
  if (input.colors && typeof input.colors === 'object') {
    const co: Record<string, string> = {}
    for (const [k, v] of Object.entries(input.colors)) if (textOk(k) && colorOk(v)) co[k] = v
    prefs.colors = co
  }
  if (typeof input.launchAtLogin === 'boolean') prefs.launchAtLogin = input.launchAtLogin
  if (typeof input.setupDone === 'boolean') prefs.setupDone = input.setupDone
  return { settings, prefs }
}

/** Snapshots + color por alias, listos para mandar por IPC. Copias nuevas, ordenadas por id. */
export function toSessionsPayload(snaps: SessionSnapshot[], p: Prefs): SessionsPayload {
  const sessions = snaps.map(s => ({ ...s })).sort((a, b) => (a.id < b.id ? -1 : 1))
  const colors: Record<string, string> = {}
  const aliases = [...new Set(sessions.map(s => s.account))].sort()
  aliases.forEach((a, i) => {
    colors[a] = p.colors[a] ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]!
  })
  return { sessions, colors }
}

/** Nombres por defecto para cuentas detectadas sin alias: Cuenta A, Cuenta B... */
export function defaultAlias(i: number): string {
  return 'Cuenta ' + String.fromCharCode(65 + (i % 26))
}

type Listener = (e: unknown, ...a: unknown[]) => void
type Ipc = {
  invoke(ch: string, ...a: unknown[]): Promise<unknown>
  on(ch: string, fn: Listener): unknown
  removeListener(ch: string, fn: Listener): unknown
}

/** La API que el preload expone como `window.ofi`. Nada de acá devuelve la clave. */
export function buildPreloadApi(ipc: Ipc) {
  return {
    onSessions(cb: (p: SessionsPayload) => void): () => void {
      const fn: Listener = (_e, p) => cb(p as SessionsPayload)
      ipc.on(CH.sessions, fn)
      void ipc.invoke(CH.getSessions).then(p => p && cb(p as SessionsPayload))
      return () => void ipc.removeListener(CH.sessions, fn)
    },
    getSettings: () => ipc.invoke(CH.getSettings) as Promise<PublicSettings>,
    saveSettings: (input: SettingsInput) =>
      ipc.invoke(CH.saveSettings, input) as Promise<{ ok: true; settings: PublicSettings } | { ok: false; error: string }>,
    clearKey: () => ipc.invoke(CH.clearKey) as Promise<PublicSettings>,
    getAccounts: () => ipc.invoke(CH.getAccounts) as Promise<Account[]>,
  }
}

export type OfiApi = ReturnType<typeof buildPreloadApi>
