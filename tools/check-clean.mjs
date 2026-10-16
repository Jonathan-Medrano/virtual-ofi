// Chequeo de "build limpio": recorre un directorio y falla si encuentra datos personales
// (rutas de usuario, emails, tokens, archivos de configuración). Se corre antes de publicar.
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, basename, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * @typedef {{ name: string, kind: 'content' | 'filename', pattern: RegExp }} ForbiddenRule
 * @typedef {{ file: string, rule: string, excerpt: string }} Violation
 */

/** @type {ForbiddenRule[]} */
export const FORBIDDEN_RULES = [
  {
    // Ruta de Windows con barra simple o doble (escapada en JSON/JS), con barra normal, la carpeta del cerebro, /home/x, /Users/x
    // (\x5c = barra invertida)
    name: 'ruta-usuario',
    kind: 'content',
    pattern: new RegExp(
      [
        String.raw`[A-Za-z]:(?:\x5c{1,2}|/)Users(?:\x5c{1,2}|/)[^\s"'\x5c/]+`,
        String.raw`[A-Za-z]:(?:\x5c{1,2}|/)PRINCIPAL\b`,
        String.raw`(?<![\w.\-])/(?:home|Users)/[A-Za-z0-9_][A-Za-z0-9_.\-]*`,
      ].join('|'),
    ),
  },
  { name: 'email', kind: 'content', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/ },
  {
    name: 'token',
    kind: 'content',
    pattern: /\bsk-[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\b[a-fA-F0-9]{32,}\b/,
  },
  { name: 'archivo-config', kind: 'filename', pattern: /^(?:\.env(?:\..*)?|settings\.json|config\.json)$/i },
]

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.icns', '.bmp', '.woff', '.woff2', '.ttf', '.otf',
  '.mp3', '.wav', '.ogg', '.mp4', '.webm', '.zip', '.gz', '.7z', '.exe', '.dll', '.node', '.blockmap', '.glb',
])
const SKIP_DIRS = new Set(['.git'])

async function* walk(dir) {
  let entries
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) yield* walk(full) }
    else if (e.isFile()) yield full
  }
}

/**
 * @param {string} dir
 * @param {ForbiddenRule[]} forbidden
 * @returns {Promise<Violation[]>}
 */
export async function checkClean(dir, forbidden = FORBIDDEN_RULES) {
  /** @type {Violation[]} */
  const out = []
  for await (const full of walk(dir)) {
    const file = relative(dir, full).split(sep).join('/')
    for (const r of forbidden) {
      if (r.kind === 'filename' && r.pattern.test(basename(full))) out.push({ file, rule: r.name, excerpt: basename(full) })
    }
    if (BINARY_EXT.has(extname(full).toLowerCase())) continue
    const content = forbidden.filter(r => r.kind === 'content')
    if (!content.length) continue
    let text
    try { text = await readFile(full, 'utf8') } catch { continue }
    for (const r of content) {
      const m = r.pattern.exec(text)
      if (m) out.push({ file, rule: r.name, excerpt: m[0].slice(0, 80) })
    }
  }
  return out
}

// CLI: node tools/check-clean.mjs <dir>  → código 1 si hay violaciones
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = process.argv[2]
  if (!dir) { console.error('Uso: check-clean <directorio>'); process.exit(2) }
  const v = await checkClean(dir, FORBIDDEN_RULES)
  if (v.length) {
    for (const x of v) console.error(`[${x.rule}] ${x.file}: ${x.excerpt}`)
    console.error(`${v.length} violación(es).`)
    process.exit(1)
  }
  console.log('Limpio.')
}
