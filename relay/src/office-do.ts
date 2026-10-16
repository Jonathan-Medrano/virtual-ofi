import { DurableObject } from 'cloudflare:workers'
import type { SessionSnapshot } from './types'
import { parsePutBody } from './validate'

const MAX_AGE_MS = 24 * 3600_000

/**
 * Estado EN MEMORIA a proposito: el plan gratis de Cloudflare limita las escrituras
 * (KV / storage del DO) y los PUT llegan seguido, asi que no se persiste nada.
 * Consecuencia: si el DO se reinicia o lo desalojan, el estado se pierde y se repone solo
 * con el proximo latido (cada PC reenvia todo como maximo a los 30 s).
 */
export class OfficeDO extends DurableObject {
  private byPc = new Map<string, SessionSnapshot[]>()

  private fresh(list: SessionSnapshot[], now: number) {
    return list.filter((s) => now - s.updatedAt <= MAX_AGE_MS)
  }

  async fetch(request: Request): Promise<Response> {
    const now = Date.now()
    if (request.method === 'PUT') {
      let raw: unknown
      try { raw = await request.json() } catch { return json({ error: 'json invalido' }, 400) }
      const body = parsePutBody(raw)
      if (!body) return json({ error: 'cuerpo invalido' }, 400)
      const keep = this.fresh(body.sessions, now)
      if (keep.length) this.byPc.set(body.pc, keep)
      else this.byPc.delete(body.pc)
      return json({ ok: true })
    }
    // GET: mezcla todas las PCs y barre lo vencido.
    const sessions: SessionSnapshot[] = []
    for (const [pc, list] of this.byPc) {
      const keep = this.fresh(list, now)
      if (keep.length) { this.byPc.set(pc, keep); sessions.push(...keep) } else this.byPc.delete(pc)
    }
    return json({ sessions })
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}
