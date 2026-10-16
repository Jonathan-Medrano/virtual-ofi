import { STATUSES, type PutBody, type SessionSnapshot } from './types'

const MAX_SESSIONS = 200
const MAX_STR = 200
const SESSION_KEYS = ['id', 'pc', 'account', 'project', 'status', 'updatedAt']

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_STR
const sameKeys = (o: Record<string, unknown>, allowed: string[]) =>
  Object.keys(o).length === allowed.length && allowed.every((k) => k in o)

/** Devuelve el cuerpo tipado o null si tiene forma invalida o campos de mas/menos. */
export function parsePutBody(raw: unknown): PutBody | null {
  if (!isObj(raw) || !sameKeys(raw, ['pc', 'sessions'])) return null
  const { pc, sessions } = raw
  if (!isStr(pc) || !Array.isArray(sessions) || sessions.length > MAX_SESSIONS) return null
  for (const s of sessions) {
    if (!isObj(s) || !sameKeys(s, SESSION_KEYS)) return null
    if (!isStr(s.id) || !isStr(s.account) || !isStr(s.project)) return null
    if (s.pc !== pc) return null // una PC solo puede publicar sus propias sesiones
    if (!STATUSES.includes(s.status as never)) return null
    if (typeof s.updatedAt !== 'number' || !Number.isFinite(s.updatedAt)) return null
  }
  return { pc, sessions: sessions as SessionSnapshot[] }
}
