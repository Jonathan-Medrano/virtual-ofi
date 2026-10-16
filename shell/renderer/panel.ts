// Lógica pura del panel de sesiones de la esquina (sin DOM): textos en español y orden. Se prueba con vitest.
import type { SessionSnapshot } from '../../core/identity'

const STATUS_ES: Record<string, string> = { working: 'trabajando', waiting: 'te espera', idle: 'libre', closed: 'cerrada' }
const ORDER: Record<string, number> = { waiting: 0, working: 1, idle: 2 }

export const statusEs = (s: string): string => STATUS_ES[s] ?? s

export interface PanelRow { id: string; text: string; status: SessionSnapshot['status']; account: string }

/** Filas del listado: sin las cerradas, primero las que esperan al usuario. */
export function panelRows(sessions: SessionSnapshot[]): PanelRow[] {
  return sessions
    .filter(s => s.status !== 'closed')
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (ORDER[a.s.status] ?? 3) - (ORDER[b.s.status] ?? 3) || a.i - b.i)
    .map(({ s }) => ({ id: s.id, text: `${s.project} · ${s.pc}`, status: s.status, account: s.account }))
}

export function countLine(sessions: SessionSnapshot[]): string {
  const live = sessions.filter(s => s.status !== 'closed')
  if (!live.length) return 'Sin sesiones activas'
  const w = live.filter(s => s.status === 'waiting').length
  const base = `${live.length} ${live.length === 1 ? 'sesión' : 'sesiones'}`
  return w ? `${base} · ${w} ${w === 1 ? 'te espera' : 'te esperan'}` : base
}

/** '#rrggbb' → número 0xrrggbb (undefined si no es un color válido). */
export function hexToInt(c: string | undefined): number | undefined {
  return c && /^#[0-9a-fA-F]{6}$/.test(c) ? parseInt(c.slice(1), 16) : undefined
}
