import { describe, it, expect } from 'vitest'
import { hashAccount, resolveAlias, toSnapshot, projectFromFolder } from './identity'

// Datos inventados: nada de usuarios ni rutas reales.
const UUID = '123e4567-e89b-12d3-a456-426614174000'
const ctx = { pc: 'PC-Casa', aliases: {} as Record<string, string> }
const base = { sessionId: 'sess-1', folderName: 'C--Users-Fulano-Desktop-mi-proyecto', status: 'working' as const, updatedAt: 1000 }

describe('projectFromFolder (criterio documentado)', () => {
  // Claude Code nombra la carpeta como la ruta con separadores, ":" y "." cambiados por "-".
  // Es ambiguo (un "-" puede ser separador o parte del nombre), así que el criterio es:
  //  1) sacar la unidad (C--) y el home (Users-<usuario> / home-<usuario>),
  //  2) sacar carpetas contenedoras conocidas (Desktop, Documents, ...),
  //  3) lo que queda es el proyecto (conserva guiones: mi-proyecto),
  //  4) si el diseño no es reconocible, solo el último segmento (nunca la ruta),
  //  5) si no queda nada, 'sin-nombre'.
  it('windows_home_with_container', () => {
    expect(projectFromFolder('C--Users-Fulano-Desktop-mi-proyecto')).toBe('mi-proyecto')
  })
  it('windows_home_without_container', () => {
    expect(projectFromFolder('C--Users-Fulano-mi-proyecto')).toBe('mi-proyecto')
  })
  it('nested_containers', () => {
    expect(projectFromFolder('C--Users-Fulano-OneDrive-Documents-tienda')).toBe('tienda')
  })
  it('unix_and_mac_homes', () => {
    expect(projectFromFolder('-home-fulano-proyectos-api-ventas')).toBe('api-ventas')
    expect(projectFromFolder('-Users-fulano-Documents-app')).toBe('app')
  })
  it('unknown_layout_keeps_only_last_segment', () => {
    expect(projectFromFolder('D--Trabajo-Clientes-Acme-web')).toBe('web')
    expect(projectFromFolder('D--Trabajo')).toBe('Trabajo')
  })
  it('home_only_or_empty_gives_fallback', () => {
    expect(projectFromFolder('C--Users-Fulano')).toBe('sin-nombre')
    expect(projectFromFolder('C--Users-Fulano-Desktop')).toBe('sin-nombre')
    expect(projectFromFolder('')).toBe('sin-nombre')
  })
})

describe('hashAccount / resolveAlias', () => {
  it('account_hash_is_not_the_uuid', () => {
    const h = hashAccount(UUID)
    expect(h).not.toContain(UUID)
    expect(h).not.toContain('123e4567')
    expect(h.length).toBeGreaterThanOrEqual(12)
  })
  it('same_uuid_same_hash', () => {
    expect(hashAccount(UUID)).toBe(hashAccount(UUID))
    expect(hashAccount(UUID)).not.toBe(hashAccount(UUID.replace('1', '2')))
  })
  it('missing_account_gives_sin_cuenta', () => {
    expect(hashAccount(undefined)).toBe('sin-cuenta')
    expect(hashAccount('')).toBe('sin-cuenta')
  })
  it('alias_resolves_or_defaults', () => {
    const h = hashAccount(UUID)
    expect(resolveAlias(h, { [h]: 'Personal' })).toBe('Personal')
    expect(resolveAlias(h, {})).toBe('Cuenta sin alias')
    expect(resolveAlias('sin-cuenta', {})).toBe('Cuenta sin alias')
  })
})

describe('toSnapshot', () => {
  it('snapshot_has_no_path', () => {
    const s = toSnapshot(base, ctx)
    expect(s.project).toBe('mi-proyecto')
    expect(JSON.stringify(s)).not.toMatch(/Fulano|Users|Desktop|C--/)
  })
  it('snapshot_keys_are_exactly_the_allowed_ones', () => {
    const s = toSnapshot({ ...base, accountUuid: UUID }, ctx)
    expect(Object.keys(s).sort()).toEqual(['account', 'id', 'pc', 'project', 'status', 'updatedAt'])
  })
  it('snapshot_never_carries_the_uuid', () => {
    const s = toSnapshot({ ...base, accountUuid: UUID }, ctx)
    expect(JSON.stringify(s)).not.toContain('123e4567')
    expect(JSON.stringify(s)).not.toContain(base.sessionId)
  })
  it('id_is_hash_of_pc_and_session', () => {
    const a = toSnapshot(base, ctx)
    expect(a.id).toBe(toSnapshot(base, ctx).id)
    expect(a.id).not.toBe(toSnapshot(base, { ...ctx, pc: 'PC-Trabajo' }).id)
    expect(a.id).not.toBe(toSnapshot({ ...base, sessionId: 'sess-2' }, ctx).id)
  })
  it('account_is_the_alias', () => {
    const aliases = { [hashAccount(UUID)]: 'Personal' }
    expect(toSnapshot({ ...base, accountUuid: UUID }, { ...ctx, aliases }).account).toBe('Personal')
    expect(toSnapshot(base, { ...ctx, aliases }).account).toBe('Cuenta sin alias')
  })
  it('passes_status_pc_and_time_through', () => {
    const s = toSnapshot({ ...base, status: 'waiting', updatedAt: 42 }, ctx)
    expect(s).toMatchObject({ pc: 'PC-Casa', status: 'waiting', updatedAt: 42 })
  })
})
