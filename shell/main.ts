// Proceso principal = el lector. Cada ~3 s lee los registros locales (y el relay si hay), y manda los snapshots a la ventana.
// Nada de clave/URL en consola: los logs de acá son genéricos.
import { app, BrowserWindow, ipcMain } from 'electron'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { createStore } from '../reader/store'
import { createSync } from '../reader/sync'
import { scanSessions } from '../reader/scan'
import { hashAccount, resolveAlias, type SessionSnapshot } from '../core/identity'
import { CH, DEFAULT_COLORS, defaultAlias, splitInput, toPublicSettings, toSessionsPayload, type Account, type SessionsPayload } from './api'
import { createPrefs } from './prefs'
import { createTray } from './tray'
import { autoUpdater } from 'electron-updater'

const TICK_MS = 3000

// Pruebas: carpeta de datos aparte para no tocar los ajustes reales (ver README del shell).
if (process.env.OFI_USERDATA) app.setPath('userData', process.env.OFI_USERDATA)

if (!app.requestSingleInstanceLock()) app.quit()

let win: BrowserWindow | null = null
let quitting = false
let last: SessionsPayload = { sessions: [], colors: {} }

const dataDir = () => app.getPath('userData')
const projectsDir = process.env.OFI_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects')

function applyLoginItem(on: boolean) {
  if (!app.isPackaged && process.env.OFI_LOGIN_ITEM !== '1') return // en desarrollo no se registra el arranque
  app.setLoginItemSettings({ openAtLogin: on })
}

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1280,
    height: 760,
    backgroundColor: '#15171a',
    title: 'Oficina virtual',
    autoHideMenuBar: true,
    show: !process.argv.includes('--hidden'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  w.removeMenu()
  if (process.argv.includes('--dev')) w.webContents.openDevTools({ mode: 'detach' })
  w.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  // Cerrar la ventana la oculta: la app sigue leyendo desde la bandeja.
  w.on('close', e => {
    if (!quitting) {
      e.preventDefault()
      w.hide()
    }
  })
  return w
}

async function detectAccounts(store: ReturnType<typeof createStore>, prefs: ReturnType<typeof createPrefs>): Promise<Account[]> {
  const raw = await scanSessions(projectsDir, Date.now()).catch(() => [])
  const hashes = [...new Set(raw.map(r => hashAccount(r.accountUuid)))].filter(h => h !== 'sin-cuenta').sort()
  const { aliases } = store.get()
  const { colors } = prefs.get()
  return hashes.map((id, i) => {
    const alias = aliases[id] ? resolveAlias(id, aliases) : defaultAlias(i)
    return { id, alias, color: colors[alias] ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]! }
  })
}

// --- Auto-actualización (solo app instalada): revisa al arrancar y cada pocas horas, descarga en segundo plano
// e instala al cerrar. Sin internet no pasa nada: el error se ignora y se reintenta en el próximo ciclo.
const UPDATE_EVERY_MS = 4 * 60 * 60 * 1000
function setupAutoUpdate() {
  if (!app.isPackaged || process.env.OFI_SHOT) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null
  autoUpdater.on('update-downloaded', info => console.log('[update] lista para instalar al cerrar:', info.version))
  autoUpdater.on('error', () => console.log('[update] sin novedades (error o sin conexión)'))
  const check = () => {
    autoUpdater.checkForUpdates().catch(() => {})
  }
  setTimeout(check, 15_000)
  setInterval(check, UPDATE_EVERY_MS)
}

function main() {
  const store = createStore(dataDir())
  const prefs = createPrefs(dataDir())
  const sync = createSync({
    projectsDir,
    store,
    now: () => Date.now(),
    fetch: (...a) => fetch(...a),
    get pcName() {
      return store.get().pcName
    },
  })

  win = createWindow()
  createTray(win, () => {
    quitting = true
    app.quit()
  })
  applyLoginItem(prefs.get().launchAtLogin)
  setupAutoUpdate()

  const push = () => win?.webContents.send(CH.sessions, last)
  let busy = false
  const tick = async () => {
    if (busy) return
    busy = true
    try {
      const snaps: SessionSnapshot[] = await sync.tick()
      last = toSessionsPayload(snaps, prefs.get())
      push()
    } catch {
      /* un fallo de lectura no tumba el lector: se reintenta en el próximo ciclo */
    } finally {
      busy = false
    }
  }
  void tick()
  setInterval(tick, TICK_MS)

  ipcMain.handle(CH.getSessions, () => last)
  ipcMain.handle(CH.getSettings, () => toPublicSettings(store.get(), prefs.get()))
  ipcMain.handle(CH.getAccounts, () => detectAccounts(store, prefs))
  ipcMain.handle(CH.clearKey, () => {
    store.set({ relayKey: undefined })
    return toPublicSettings(store.get(), prefs.get())
  })
  ipcMain.handle(CH.saveSettings, (_e, input) => {
    const r = splitInput(input ?? {}, prefs.get())
    if ('error' in r) return { ok: false as const, error: r.error }
    store.set(r.settings)
    prefs.set(r.prefs)
    applyLoginItem(r.prefs.launchAtLogin)
    void tick()
    return { ok: true as const, settings: toPublicSettings(store.get(), prefs.get()) }
  })

  // Modo captura (pruebas): guarda una imagen de la ventana y sale.
  const shot = process.env.OFI_SHOT
  if (shot) {
    const wait = Number(process.env.OFI_SHOT_WAIT_MS) || 6000
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        // capturePage puede fallar (UnknownVizError) si el compositor aún no entregó un cuadro: reintenta y nunca deja la app colgada.
        let ok = false
        for (let i = 0; i < 8 && !ok; i++) {
          try {
            win!.webContents.invalidate()
            const img = await win!.webContents.capturePage()
            if (!img.isEmpty()) {
              fs.writeFileSync(shot, img.toPNG())
              ok = true
            }
          } catch (e) {
            console.log('[shot] reintento', i + 1, (e as Error).message)
          }
          if (!ok) await new Promise(r => setTimeout(r, 1000))
        }
        if (!ok) process.exitCode = 1
        quitting = true
        app.quit()
      }, wait)
    })
  }
}

app.on('second-instance', () => {
  if (win) {
    win.show()
    win.focus()
  }
})
app.on('before-quit', () => {
  quitting = true
})
app.on('window-all-closed', () => {
  /* la app vive en la bandeja */
})
app.whenReady().then(main)
