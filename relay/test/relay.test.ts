import { SELF, env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

type Status = 'working' | 'waiting' | 'idle' | 'closed'
interface Snap { id: string; pc: string; account: string; project: string; status: Status; updatedAt: number }

const KEY = 'clave-de-prueba'
const auth = { Authorization: `Bearer ${KEY}` }
const snap = (pc: string, id: string, over: Partial<Snap> = {}): Snap => ({
  id, pc, account: 'cuenta-a', project: 'proyecto-x', status: 'working', updatedAt: Date.now(), ...over,
})
const put = (body: unknown, headers: Record<string, string> = auth) =>
  SELF.fetch('https://relay.test/state', { method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
const get = (headers: Record<string, string> = auth) => SELF.fetch('https://relay.test/state', { headers })
const ids = async () => ((await (await get()).json()) as { sessions: Snap[] }).sessions.map((s) => s.id).sort()

beforeEach(async () => {
  // El estado vive en memoria del DO: lo vaciamos mandando cero sesiones de las PCs usadas.
  for (const pc of ['pc1', 'pc2']) await put({ pc, sessions: [] })
})

describe('relay', () => {
  it('put_without_key_is_401', async () => {
    expect((await put({ pc: 'pc1', sessions: [] }, {})).status).toBe(401)
  })

  it('bad_key_is_401', async () => {
    expect((await get({ Authorization: 'Bearer otra' })).status).toBe(401)
    expect((await get({})).status).toBe(401)
    expect((await put({ pc: 'pc1', sessions: [] }, { Authorization: 'Bearer otra' })).status).toBe(401)
  })

  it('put_then_get_returns_sessions', async () => {
    const s = snap('pc1', 'a')
    expect((await put({ pc: 'pc1', sessions: [s] })).status).toBe(200)
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sessions: [s] })
  })

  it('two_pcs_are_merged', async () => {
    await put({ pc: 'pc1', sessions: [snap('pc1', 'a')] })
    await put({ pc: 'pc2', sessions: [snap('pc2', 'b')] })
    expect(await ids()).toEqual(['a', 'b'])
  })

  it('second_put_from_same_pc_replaces_its_sessions', async () => {
    await put({ pc: 'pc1', sessions: [snap('pc1', 'a'), snap('pc1', 'a2')] })
    await put({ pc: 'pc2', sessions: [snap('pc2', 'b')] })
    await put({ pc: 'pc1', sessions: [snap('pc1', 'c')] })
    expect(await ids()).toEqual(['b', 'c'])
  })

  it('old_sessions_expire', async () => {
    const old = snap('pc1', 'viejo', { updatedAt: Date.now() - 25 * 3600_000 })
    const fresh = snap('pc1', 'nuevo', { updatedAt: Date.now() - 23 * 3600_000 })
    await put({ pc: 'pc1', sessions: [old, fresh] })
    expect(await ids()).toEqual(['nuevo'])
  })

  it('body_with_extra_fields_is_rejected', async () => {
    expect((await put({ pc: 'pc1', sessions: [], extra: 1 })).status).toBe(400)
    expect((await put({ pc: 'pc1', sessions: [{ ...snap('pc1', 'a'), secreto: 'x' }] })).status).toBe(400)
    expect((await put({ pc: 'pc1', sessions: [snap('pc1', 'a', { status: 'raro' as Status })] })).status).toBe(400)
    expect((await put({ pc: 'pc1', sessions: [snap('pc2', 'a')] })).status).toBe(400)
    expect(await ids()).toEqual([])
  })

  it('unknown_route_and_method', async () => {
    expect((await SELF.fetch('https://relay.test/otra', { headers: auth })).status).toBe(404)
    expect((await SELF.fetch('https://relay.test/state', { method: 'DELETE', headers: auth })).status).toBe(405)
  })
})

void env
