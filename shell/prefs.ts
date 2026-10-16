import fs from 'node:fs'
import path from 'node:path'
import type { Prefs } from './api'

const FILE = 'prefs.json'

/** Preferencias de la cáscara (colores, arranque, primera vez). Solo dentro de `dataDir`. */
export function createPrefs(dataDir: string) {
  const file = path.join(dataDir, FILE)
  const get = (): Prefs => {
    try {
      const o = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Prefs>
      const colors: Record<string, string> = {}
      if (o.colors && typeof o.colors === 'object') {
        for (const [k, v] of Object.entries(o.colors)) if (typeof v === 'string') colors[k] = v
      }
      return { colors, launchAtLogin: o.launchAtLogin === true, setupDone: o.setupDone === true }
    } catch {
      return { colors: {}, launchAtLogin: false, setupDone: false }
    }
  }
  return {
    get,
    set(p: Prefs): void {
      fs.mkdirSync(dataDir, { recursive: true })
      const tmp = file + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(p, null, 2))
      fs.renameSync(tmp, file)
    },
  }
}
