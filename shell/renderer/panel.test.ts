import { describe, it, expect } from 'vitest'
import { statusEs, panelRows, hexToInt, countLine } from './panel'
import type { SessionSnapshot } from '../../core/identity'

const snap = (id: string, status: SessionSnapshot['status'], project = 'p'): SessionSnapshot =>
  ({ id, pc: 'PC', account: 'A', project, status, updatedAt: 1 })

describe('panel de sesiones', () => {
  it('traduce el estado al español que ve el usuario', () => {
    expect(statusEs('working')).toBe('trabajando')
    expect(statusEs('waiting')).toBe('te espera')
    expect(statusEs('idle')).toBe('libre')
    expect(statusEs('closed')).toBe('cerrada')
  })
  it('las cerradas no aparecen en el listado; las que esperan van primero', () => {
    const rows = panelRows([snap('1', 'working', 'b'), snap('2', 'closed'), snap('3', 'waiting', 'c'), snap('4', 'idle', 'a')])
    expect(rows.map(r => r.status)).toEqual(['waiting', 'working', 'idle'])
    expect(rows[0]!.text).toBe('c · PC')
  })
  it('hexToInt convierte #rrggbb y rechaza basura', () => {
    expect(hexToInt('#3fa7e8')).toBe(0x3fa7e8)
    expect(hexToInt('azul')).toBeUndefined()
    expect(hexToInt(undefined)).toBeUndefined()
  })
  it('countLine resume cuántas hay y cuántas esperan', () => {
    expect(countLine([])).toBe('Sin sesiones activas')
    expect(countLine([snap('1', 'working')])).toBe('1 sesión')
    expect(countLine([snap('1', 'working'), snap('2', 'waiting'), snap('3', 'waiting')])).toBe('3 sesiones · 2 te esperan')
    expect(countLine([snap('1', 'waiting')])).toBe('1 sesión · 1 te espera')
  })
})
