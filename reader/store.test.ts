import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createStore } from './store'

let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ofi-store-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

describe('store', () => {
  it('store_defaults_and_persists', () => {
    const s = createStore(dir)
    const d = s.get()
    expect(d.idleMs).toBe(120_000)
    expect(d.closedMs).toBe(900_000)
    expect(d.aliases).toEqual({})
    expect(d.pcName).toMatch(/^[A-Za-z0-9_-]{1,32}$/)
    expect(d.relayUrl).toBeUndefined()
    s.set({ relayUrl: 'https://r.example', relayKey: 'k', pcName: 'PC-1', aliases: { abc: 'Ana' } })
    expect(createStore(dir).get()).toMatchObject({
      relayUrl: 'https://r.example', relayKey: 'k', pcName: 'PC-1', aliases: { abc: 'Ana' }, idleMs: 120_000,
    })
    s.set({ idleMs: 5 })
    expect(createStore(dir).get().aliases).toEqual({ abc: 'Ana' })
    expect(createStore(dir).get().idleMs).toBe(5)
  })
  it('store_corrupt_file_gives_defaults', () => {
    fs.writeFileSync(path.join(dir, 'settings.json'), '{ esto no es json')
    const d = createStore(dir).get()
    expect(d.idleMs).toBe(120_000)
    expect(d.aliases).toEqual({})
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ idleMs: 'x', aliases: 5, pcName: '' }))
    const e = createStore(dir).get()
    expect(e.idleMs).toBe(120_000)
    expect(e.aliases).toEqual({})
    expect(e.pcName.length).toBeGreaterThan(0)
  })
})
