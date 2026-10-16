export type SessionStatus = 'working' | 'waiting' | 'idle' | 'closed';

export type SessionRecord = {
  type: string;
  subtype?: string;
  timestamp?: string;
  sessionId?: string;
  [k: string]: unknown;
};

/** Herramienta pendiente (tool_use sin resultado) más de este tiempo => "waiting" (heurística de permiso). */
export const PENDING_TOOL_MS = 15_000;

const DEFAULTS = { idleMs: 120_000, closedMs: 900_000 };

/** Un JSON por línea. Descarta líneas vacías, inválidas (p. ej. la última a medias) y no-objetos. */
export function parseLines(raw: string): SessionRecord[] {
  const out: SessionRecord[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const v: unknown = JSON.parse(t);
      if (v && typeof v === 'object' && !Array.isArray(v) && typeof (v as SessionRecord).type === 'string') {
        out.push(v as SessionRecord);
      }
    } catch {
      // línea truncada o corrupta: se ignora
    }
  }
  return out;
}

const time = (r: SessionRecord): number => {
  const n = typeof r.timestamp === 'string' ? Date.parse(r.timestamp) : NaN;
  return Number.isFinite(n) ? n : NaN;
};

const stopReason = (r: SessionRecord): unknown =>
  (r.message as { stop_reason?: unknown } | undefined)?.stop_reason;

/** Registros que mueven el estado: user, assistant y system/turn_duration. El resto es ruido. */
const isUseful = (r: SessionRecord): boolean =>
  r.type === 'user' || r.type === 'assistant' || (r.type === 'system' && r.subtype === 'turn_duration');

/** Reglas de docs/REGISTROS.md ("Reglas de estado"). */
export function deriveStatus(
  records: SessionRecord[],
  now: number,
  opts: { idleMs: number; closedMs: number } = DEFAULTS,
): SessionStatus {
  let lastActivity = NaN; // mayor timestamp de cualquier registro
  let lastUseful: SessionRecord | undefined;
  let lastUsefulAt = NaN;
  for (const r of records) {
    const t = time(r);
    if (Number.isNaN(t)) continue;
    if (Number.isNaN(lastActivity) || t > lastActivity) lastActivity = t;
    if (isUseful(r)) {
      lastUseful = r;
      lastUsefulAt = t;
    }
  }
  if (!lastUseful || now - lastActivity >= opts.closedMs) return 'closed';

  const age = now - lastUsefulAt;
  const sr = lastUseful.type === 'assistant' ? stopReason(lastUseful) : undefined;

  if (lastUseful.type === 'system' || sr === 'end_turn') {
    return age < opts.idleMs ? 'waiting' : 'idle';
  }
  if (sr === 'tool_use') {
    return age < PENDING_TOOL_MS ? 'working' : 'waiting';
  }
  return age < opts.idleMs ? 'working' : 'idle';
}
