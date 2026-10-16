import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanSessions, TAIL_BYTES } from './scan'

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'core', 'fixtures')
const NOW = Date.parse('2026-10-16T12:05:00.000Z')
let dir: string

const fixture = (name: string) => fs.readFileSync(path.join(FIX, name), 'utf8')
function put(folder: string, file: string, content: string, mtime = NOW - 60_000) {
  const d = path.join(dir, folder)
  fs.mkdirSync(d, { recursive: true })
  const p = path.join(d, file)
  fs.writeFileSync(p, content)
  fs.utimesSync(p, mtime / 1000, mtime / 1000)
  return p
}

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ofi-scan-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

const filler = JSON.stringify({ type: 'attachment', timestamp: '2026-10-16T09:00:00.000Z', pad: 'x'.repeat(900) }) + '\n'
const fillerFor = (bytes: number) => filler.repeat(Math.ceil(bytes / filler.length))

describe('scanSessions', () => {
  it('empty_dir_gives_empty', async () => {
    expect(await scanSessions(dir, NOW)).toEqual([])
  })
  it('missing_dir_gives_empty', async () => {
    expect(await scanSessions(path.join(dir, 'no-existe'), NOW)).toEqual([])
  })
  it('only_recent_files', async () => {
    put('C--Users-Ana-Desktop-uno', 'a.jsonl', fixture('working.jsonl'))
    put('C--Users-Ana-Desktop-uno', 'viejo.jsonl', fixture('working.jsonl'), NOW - 2 * 86_400_000)
    put('C--Users-Ana-Desktop-uno', 'nota.txt', 'hola')
    const r = await scanSessions(dir, NOW)
    expect(r.map(s => s.sessionId)).toEqual(['a'])
    expect(r[0].folderName).toBe('C--Users-Ana-Desktop-uno')
    expect(r[0].records.length).toBeGreaterThan(0)
    expect(r[0].lastActivity).toBeGreaterThan(0)
  })
  it('reads_tail_only', async () => {
    const head = JSON.stringify({ type: 'user', timestamp: '2026-10-16T08:00:00.000Z', marker: 'HEAD' }) + '\n'
    put('C--Users-Ana-Desktop-uno', 'big.jsonl', head + fillerFor(TAIL_BYTES * 2) + fixture('turn_end.jsonl'))
    const [s] = await scanSessions(dir, NOW)
    expect(s.records.some(r => r.marker === 'HEAD')).toBe(false)
    const bytes = s.records.reduce((n, r) => n + JSON.stringify(r).length, 0)
    expect(bytes).toBeLessThan(TAIL_BYTES + 2000)
    expect(s.records[s.records.length - 1].type).toBe('system')
  })
  it('reads_account_uuid', async () => {
    put('C--Users-Ana-Desktop-uno', 'cola.jsonl', fixture('working.jsonl'))
    const bridge = '{"type":"bridge-session","sessionId":"s2","ownerAccountUuid":"00000000-0000-4000-8000-000000000002"}\n'
    put('C--Users-Ana-Desktop-uno', 'cabeza.jsonl', bridge + fillerFor(TAIL_BYTES * 2))
    put('C--Users-Ana-Desktop-uno', 'sin.jsonl', filler)
    const r = Object.fromEntries((await scanSessions(dir, NOW)).map(s => [s.sessionId, s.accountUuid]))
    expect(r.cola).toBe('00000000-0000-4000-8000-000000000001')
    expect(r.cabeza).toBe('00000000-0000-4000-8000-000000000002')
    expect(r.sin).toBeUndefined()
  })
  it('corrupt_file_skipped', async () => {
    put('C--Users-Ana-Desktop-uno', 'bueno.jsonl', fixture('working.jsonl'))
    put('C--Users-Ana-Desktop-uno', 'basura.jsonl', '\u0000\u0001{{{ no json\nzzz')
    fs.mkdirSync(path.join(dir, 'C--Users-Ana-Desktop-uno', 'dir.jsonl'))
    const r = await scanSessions(dir, NOW)
    expect(r.map(s => s.sessionId)).toContain('bueno')
    expect(r.map(s => s.sessionId)).not.toContain('dir')
  })
})
