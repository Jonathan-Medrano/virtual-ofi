import type { OfficeDO } from './office-do'
export { OfficeDO } from './office-do'

interface Env {
  OFFICE: DurableObjectNamespace<OfficeDO>
  RELAY_KEY: string
}

const MAX_BODY = 256 * 1024

/** Comparacion en tiempo constante (hash de ambos para igualar longitudes). */
async function sameKey(given: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder()
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ])
  const x = new Uint8Array(a), y = new Uint8Array(b)
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

const reply = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json' } })

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname !== '/state') return reply(404, 'no existe')

    const header = request.headers.get('Authorization') ?? ''
    const given = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (!env.RELAY_KEY || !given || !(await sameKey(given, env.RELAY_KEY))) return reply(401, 'no autorizado')

    if (request.method !== 'GET' && request.method !== 'PUT') return reply(405, 'metodo no permitido')
    if (request.method === 'PUT') {
      const text = await request.text()
      if (text.length > MAX_BODY) return reply(413, 'cuerpo muy grande')
      request = new Request(request.url, { method: 'PUT', body: text, headers: { 'content-type': 'application/json' } })
    }
    // Un unico DO ("oficina") concentra a todas las PCs.
    return env.OFFICE.get(env.OFFICE.idFromName('oficina')).fetch(request)
  },
}
