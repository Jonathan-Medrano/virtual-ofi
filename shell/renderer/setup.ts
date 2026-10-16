// Pantalla de primera vez / ajustes. Se habla con el proceso principal solo por window.ofi (sin clave de vuelta).
import type { OfiApi, Account } from '../api'

declare global {
  interface Window {
    ofi: OfiApi
  }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

export async function initSetup(): Promise<void> {
  const panel = $('setup')
  const err = $('err')
  let accounts: Account[] = []

  async function open(first: boolean) {
    const s = await window.ofi.getSettings()
    accounts = await window.ofi.getAccounts()
    $('setup-title').textContent = first ? 'Bienvenido a la oficina' : 'Ajustes'
    $<HTMLInputElement>('url').value = s.relayUrl
    $<HTMLInputElement>('key').value = ''
    $('keyhint').textContent = s.hasKey
      ? 'Ya hay una clave guardada. Dejalo vacío para conservarla, o escribí otra para reemplazarla.'
      : 'Se guarda solo en esta PC y no se vuelve a mostrar.'
    $<HTMLInputElement>('pc').value = s.pcName
    $<HTMLInputElement>('login').checked = s.launchAtLogin
    const box = $('accs')
    box.textContent = ''
    if (!accounts.length) {
      const p = document.createElement('div')
      p.className = 'empty'
      p.style.color = 'var(--dim)'
      p.textContent = 'Todavía no se detectó ninguna cuenta.'
      box.append(p)
    }
    for (const a of accounts) {
      const row = document.createElement('div')
      row.className = 'acc'
      const t = document.createElement('input')
      t.type = 'text'
      t.value = a.alias
      t.maxLength = 24
      t.dataset.id = a.id
      const c = document.createElement('input')
      c.type = 'color'
      c.value = a.color
      row.append(t, c)
      box.append(row)
    }
    err.textContent = ''
    panel.classList.add('on')
  }

  async function save(done: boolean) {
    const aliases: Record<string, string> = {}
    const colors: Record<string, string> = {}
    document.querySelectorAll<HTMLDivElement>('#accs .acc').forEach(row => {
      const t = row.querySelector<HTMLInputElement>('input[type=text]')!
      const c = row.querySelector<HTMLInputElement>('input[type=color]')!
      aliases[t.dataset.id!] = t.value
      colors[t.value.trim()] = c.value
    })
    const r = await window.ofi.saveSettings({
      relayUrl: $<HTMLInputElement>('url').value,
      relayKey: $<HTMLInputElement>('key').value,
      pcName: $<HTMLInputElement>('pc').value,
      aliases,
      colors,
      launchAtLogin: $<HTMLInputElement>('login').checked,
      setupDone: done,
    })
    $<HTMLInputElement>('key').value = ''
    if (!r.ok) {
      err.textContent = r.error
      return
    }
    panel.classList.remove('on')
  }

  $('save').addEventListener('click', () => void save(true))
  $('skip').addEventListener('click', async () => {
    const s = await window.ofi.getSettings()
    if (!s.setupDone) await window.ofi.saveSettings({ setupDone: true })
    panel.classList.remove('on')
  })
  $('gear').addEventListener('click', () => void open(false))

  const s = await window.ofi.getSettings()
  if (!s.setupDone) await open(true)
}
