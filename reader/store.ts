import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type Settings = {
  relayUrl?: string
  relayKey?: string
  pcName: string
  aliases: Record<string, string>
  idleMs: number
  closedMs: number
}

const FILE = 'settings.json'

/** Nombre de PC apto para viajar: sin rutas, sin ":" ni "@" (ver core/privacy). */
function cleanPcName(raw: string): string {
  const s = raw.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)
  return s || 'PC'
}

const isPosNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0

function normalize(raw: unknown): Settings {
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  const aliases: Record<string, string> = {}
  if (o.aliases && typeof o.aliases === 'object' && !Array.isArray(o.aliases)) {
    for (const [k, v] of Object.entries(o.aliases)) if (typeof v === 'string') aliases[k] = v
  }
  return {
    ...(isStr(o.relayUrl) ? { relayUrl: o.relayUrl } : {}),
    ...(isStr(o.relayKey) ? { relayKey: o.relayKey } : {}),
    pcName: isStr(o.pcName) ? o.pcName : cleanPcName(os.hostname()),
    aliases,
    idleMs: isPosNum(o.idleMs) ? o.idleMs : 120_000,
    closedMs: isPosNum(o.closedMs) ? o.closedMs : 900_000,
  }
}

/**
 * Ajustes en `<dataDir>/settings.json`. Tolera archivo ausente o corrupto (vuelve a defaults).
 * Nunca imprime nada: ahí vive la clave del relay.
 */
export function createStore(dataDir: string) {
  const file = path.join(dataDir, FILE)
  const load = (): Settings => {
    try {
      return normalize(JSON.parse(fs.readFileSync(file, 'utf8')))
    } catch {
      return normalize({})
    }
  }
  return {
    get(): Settings {
      return load()
    },
    set(patch: Partial<Settings>): void {
      const merged = normalize({ ...load(), ...patch })
      fs.mkdirSync(dataDir, { recursive: true })
      const tmp = file + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), { mode: 0o600 })
      fs.renameSync(tmp, file)
    },
  }
}
