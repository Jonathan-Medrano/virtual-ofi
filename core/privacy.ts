import type { SessionSnapshot } from './identity'

export const ALLOWED_SNAPSHOT_KEYS = ['id', 'pc', 'account', 'project', 'status', 'updatedAt'] as const
const STATUSES = ['working', 'waiting', 'idle', 'closed']
const MAX_LEN = 64

// Un texto que viaja no puede parecer ruta, email ni contener separadores.
const textOk = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= MAX_LEN && !/[\/:@]/.test(v)

/**
 * Puerta de salida/entrada: devuelve el snapshot solo si tiene EXACTAMENTE las claves
 * permitidas con valores del tipo correcto y sin rutas ni emails; si no, null.
 * Devuelve una copia nueva (nunca el objeto recibido).
 */
export function sanitizeSnapshot(v: unknown): SessionSnapshot | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  const keys = Object.keys(o)
  if (keys.length !== ALLOWED_SNAPSHOT_KEYS.length || !ALLOWED_SNAPSHOT_KEYS.every(k => keys.includes(k))) return null
  if (!textOk(o.id) || !textOk(o.pc) || !textOk(o.account) || !textOk(o.project)) return null
  if (typeof o.status !== 'string' || !STATUSES.includes(o.status)) return null
  if (typeof o.updatedAt !== 'number' || !Number.isFinite(o.updatedAt)) return null
  return {
    id: o.id, pc: o.pc, account: o.account, project: o.project,
    status: o.status as SessionSnapshot['status'], updatedAt: o.updatedAt,
  }
}
