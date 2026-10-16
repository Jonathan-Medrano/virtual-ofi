import fs from 'node:fs/promises'
import path from 'node:path'
import { parseLines, type SessionRecord } from '../core/state'

export type RawSession = {
  sessionId: string
  folderName: string
  accountUuid?: string
  records: SessionRecord[]
  lastActivity: number
}

/** Cuánto se lee del final de cada archivo (los registros viejos no cambian el estado). */
export const TAIL_BYTES = 256 * 1024
/** Cuánto se lee de la cabeza si el bridge-session no aparece en la cola. */
export const HEAD_BYTES = 64 * 1024
/** Ventana de actividad (por mtime). */
export const WINDOW_MS = 24 * 60 * 60 * 1000

async function readRange(file: string, size: number, position: number, length: number): Promise<string> {
  const fh = await fs.open(file, 'r')
  try {
    const len = Math.min(length, size - position)
    const buf = Buffer.alloc(len)
    const { bytesRead } = await fh.read(buf, 0, len, position)
    return buf.subarray(0, bytesRead).toString('utf8')
  } finally {
    await fh.close()
  }
}

const ownerOf = (records: SessionRecord[]): string | undefined => {
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i]
    if (r.type === 'bridge-session' && typeof r.ownerAccountUuid === 'string' && r.ownerAccountUuid) {
      return r.ownerAccountUuid
    }
  }
  return undefined
}

async function readSession(file: string, folderName: string, size: number, mtimeMs: number): Promise<RawSession> {
  const start = Math.max(0, size - TAIL_BYTES)
  let text = await readRange(file, size, start, TAIL_BYTES)
  // si arrancamos a mitad del archivo, la primera línea está cortada: se descarta
  if (start > 0) {
    const nl = text.indexOf('\n')
    text = nl === -1 ? '' : text.slice(nl + 1)
  }
  const records = parseLines(text)
  let accountUuid = ownerOf(records)
  if (!accountUuid && start > 0) {
    accountUuid = ownerOf(parseLines(await readRange(file, size, 0, HEAD_BYTES)))
  }
  let lastActivity = NaN
  for (const r of records) {
    const t = typeof r.timestamp === 'string' ? Date.parse(r.timestamp) : NaN
    if (Number.isFinite(t) && (Number.isNaN(lastActivity) || t > lastActivity)) lastActivity = t
  }
  return {
    sessionId: path.basename(file, '.jsonl'),
    folderName,
    ...(accountUuid ? { accountUuid } : {}),
    records,
    lastActivity: Number.isNaN(lastActivity) ? mtimeMs : lastActivity,
  }
}

/** Sesiones con actividad (mtime) dentro del último día. Nunca tira: lo ilegible se salta. */
export async function scanSessions(projectsDir: string, now: number): Promise<RawSession[]> {
  let folders: string[]
  try {
    folders = await fs.readdir(projectsDir)
  } catch {
    return []
  }
  const out: RawSession[] = []
  for (const folder of folders) {
    let files: string[]
    try {
      files = await fs.readdir(path.join(projectsDir, folder))
    } catch {
      continue // no es carpeta o no se puede leer
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue
      const file = path.join(projectsDir, folder, f)
      try {
        const st = await fs.stat(file)
        if (!st.isFile() || now - st.mtimeMs > WINDOW_MS) continue
        out.push(await readSession(file, folder, st.size, st.mtimeMs))
      } catch {
        // archivo ilegible: se salta
      }
    }
  }
  return out
}
