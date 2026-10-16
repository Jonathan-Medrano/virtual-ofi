import { createHash } from 'node:crypto'
import type { SessionStatus } from './state'

/** Lo ÚNICO que sale de la PC. Ver `privacy.ts` para la validación estricta. */
export type SessionSnapshot = {
  id: string
  pc: string
  /** Alias de la cuenta (nunca el uuid ni su hash). */
  account: string
  /** Nombre corto del proyecto, sin ruta. */
  project: string
  status: SessionStatus
  updatedAt: number
}

const NO_ACCOUNT = 'sin-cuenta'
const NO_ALIAS = 'Cuenta sin alias'
const NO_PROJECT = 'sin-nombre'

const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16)

/** Hash estable y opaco del uuid de la cuenta (con sal fija de la app). */
export function hashAccount(accountUuid: string | undefined): string {
  return accountUuid ? sha('ofi-account-v1:' + accountUuid) : NO_ACCOUNT
}

export function resolveAlias(hash: string, aliases: Record<string, string>): string {
  const a = Object.prototype.hasOwnProperty.call(aliases, hash) ? aliases[hash] : undefined
  return a && a.trim() ? a : NO_ALIAS
}

// Carpetas "contenedoras" típicas que cuelgan del home y no son el proyecto.
const CONTAINERS = new Set([
  'desktop', 'documents', 'downloads', 'onedrive', 'escritorio', 'documentos', 'descargas',
  'repos', 'source', 'projects', 'proyectos', 'workspace', 'github',
])

/**
 * Claude Code nombra la carpeta de cada proyecto como su ruta con separadores, ":" y "."
 * reemplazados por "-" (C--Users-Fulano-Desktop-mi-proyecto). Es ambiguo (un "-" puede ser
 * separador o parte del nombre), por eso el criterio es:
 *  1) quitar la unidad (`C--`) y el home (`Users-<usuario>` / `home-<usuario>`),
 *  2) quitar carpetas contenedoras conocidas (Desktop, Documents, ...),
 *  3) lo que queda es el proyecto, conservando guiones (mi-proyecto),
 *  4) si el diseño no se reconoce (no hay home), solo el último segmento: nunca la ruta,
 *  5) si no queda nada, 'sin-nombre'.
 * Límite conocido: un usuario con "." o "-" en su nombre deja una parte colada en (1).
 */
export function projectFromFolder(folderName: string): string {
  const tokens = folderName.replace(/^[A-Za-z]--/, '').split('-').filter(Boolean)
  if (tokens.length && ['users', 'home'].includes(tokens[0].toLowerCase())) {
    const rest = tokens.slice(2)
    while (rest.length && CONTAINERS.has(rest[0].toLowerCase())) rest.shift()
    return rest.join('-') || NO_PROJECT
  }
  return tokens[tokens.length - 1] ?? NO_PROJECT
}

export function toSnapshot(
  input: { sessionId: string; folderName: string; accountUuid?: string; status: SessionStatus; updatedAt: number },
  ctx: { pc: string; aliases: Record<string, string> },
): SessionSnapshot {
  return {
    id: sha(ctx.pc + ':' + input.sessionId),
    pc: ctx.pc,
    account: resolveAlias(hashAccount(input.accountUuid), ctx.aliases),
    project: projectFromFolder(input.folderName),
    status: input.status,
    updatedAt: input.updatedAt,
  }
}
