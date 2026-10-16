import { describe, it, expect } from 'vitest'
import { ALLOWED_SNAPSHOT_KEYS, sanitizeSnapshot } from './privacy'
import { toSnapshot } from './identity'

const BS = String.fromCharCode(92)
const ok = { id: 'abc123', pc: 'PC-Casa', account: 'Personal', project: 'mi-proyecto', status: 'working', updatedAt: 1000 }

describe('sanitizeSnapshot', () => {
  it('exposes_the_allowed_keys', () => {
    expect([...ALLOWED_SNAPSHOT_KEYS].sort()).toEqual(['account', 'id', 'pc', 'project', 'status', 'updatedAt'])
  })
  it('accepts_a_real_snapshot', () => {
    const s = toSnapshot({ sessionId: 's', folderName: 'C--Users-Fulano-Desktop-x', status: 'idle', updatedAt: 5 }, { pc: 'PC', aliases: {} })
    expect(sanitizeSnapshot(s)).toEqual(s)
  })
  it('rejects_extra_fields', () => {
    expect(sanitizeSnapshot({ ...ok, cwd: 'x' })).toBeNull()
    expect(sanitizeSnapshot({ ...ok, text: 'hola' })).toBeNull()
  })
  it('rejects_missing_or_wrong_types', () => {
    const { id: _id, ...sinId } = ok
    expect(sanitizeSnapshot(sinId)).toBeNull()
    expect(sanitizeSnapshot({ ...ok, updatedAt: '1000' })).toBeNull()
    expect(sanitizeSnapshot({ ...ok, updatedAt: NaN })).toBeNull()
    expect(sanitizeSnapshot({ ...ok, status: 'dormido' })).toBeNull()
    for (const v of [null, undefined, 'x', 3, [], [ok]]) expect(sanitizeSnapshot(v)).toBeNull()
  })
  it('rejects_paths_and_emails_in_text_fields', () => {
    expect(sanitizeSnapshot({ ...ok, project: `C:${BS}Users${BS}Fulano` })).toBeNull()
    expect(sanitizeSnapshot({ ...ok, project: 'a/b' })).toBeNull()
    expect(sanitizeSnapshot({ ...ok, account: 'fulano@ejemplo.com' })).toBeNull()
    expect(sanitizeSnapshot({ ...ok, pc: '/home/fulano' })).toBeNull()
  })
  it('rejects_overlong_strings', () => {
    expect(sanitizeSnapshot({ ...ok, project: 'x'.repeat(200) })).toBeNull()
  })
})
