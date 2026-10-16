// Release de la app: tests + typecheck → build → instalador → chequeo de limpieza → (solo con --publish) GitHub Release.
// Por defecto es un DRY-RUN: genera todo y verifica, pero no sube nada.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkClean, FORBIDDEN_RULES } from './check-clean.mjs'

export const ELECTRON_STOCK = f => /(?:^|\/)[^/]+\.pak$|^icudtl\.dat$|^LICENSES\.chromium\.html$|^resources\/app\.asar$/.test(f)

/** Lanza un Error si el directorio tiene datos personales. No publica ni toca la red. */
export async function assertReleasable(dir, ignore = () => false) {
  const v = (await checkClean(dir, FORBIDDEN_RULES)).filter(x => !ignore(x.file))
  if (v.length) {
    const lines = v.slice(0, 20).map(x => `  [${x.rule}] ${x.file}: ${x.excerpt}`).join('\n')
    throw new Error(`${v.length} violación(es) de build limpio; release abortado.\n${lines}`)
  }
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts })
  if (r.status !== 0) throw new Error(`Falló: ${cmd} ${args.join(' ')}`)
}

export async function main(argv) {
  const publish = argv.includes('--publish')
  run('npm', ['test'])
  run('npm', ['run', 'typecheck'])
  run('npm', ['run', 'app:build'])
  run('npx', ['electron-builder', '--win', '--publish', 'never'])

  // Contenido desempaquetado + el app.asar extraído (el asar es opaco para el chequeo si no se abre).
  const unpacked = 'release/win-unpacked'
  const tmp = mkdtempSync(join(tmpdir(), 'ofi-asar-'))
  try {
    const asar = await import('@electron/asar').then(m => m.default ?? m)
    asar.extractAll(join(unpacked, 'resources', 'app.asar'), tmp)
    await assertReleasable(tmp)
    // Resto del paquete: se ignoran SOLO archivos de serie de Electron/Chromium (datos binarios y licencias que dan falsos
    // positivos) y el app.asar crudo (su cabecera lleva un hash SHA-256 que parece token; su contenido ya se revisó extraído).
    await assertReleasable(unpacked, ELECTRON_STOCK)
    console.log('Chequeo de limpieza: 0 violaciones.')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }

  const version = JSON.parse(readFileSync('package.json', 'utf8')).version
  const files = readdirSync('release').filter(f => /\.(exe|blockmap|yml)$/.test(f) && (f !== 'builder-debug.yml'))
  if (!publish) {
    console.log(`DRY-RUN: no se publicó nada. Para publicar v${version}: npm run release -- --publish`)
    console.log('Archivos listos:', files.join(', '))
    return
  }
  const tag = `v${version}`
  run('gh', ['release', 'create', tag, ...files.map(f => join('release', f)), '--title', tag, '--notes', `Versión ${version}`])
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exit(1) })
}
