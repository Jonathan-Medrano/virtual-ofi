import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkClean, FORBIDDEN_RULES } from './check-clean.mjs'

// Todos los datos de estos tests son inventados (Fulano, ejemplo.com, etc.).
const BS = String.fromCharCode(92) // barra invertida sin escapes en el fuente
const win = (...parts: string[]) => parts.join(BS)

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ofi-clean-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })
const put = (name: string, text: string) => {
  const p = join(dir, name)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, text)
}
const rulesHit = async () => (await checkClean(dir, FORBIDDEN_RULES)).map(v => v.rule)

describe('checkClean', () => {
  it('detects_user_path', async () => {
    put('a.txt', 'ruta ' + win('C:', 'Users', 'Fulano', 'x'))
    const v = await checkClean(dir, FORBIDDEN_RULES)
    expect(v).toHaveLength(1)
    expect(v[0].rule).toBe('ruta-usuario')
    expect(v[0].file).toBe('a.txt')
    expect(v[0].excerpt).toContain('Fulano')
  })

  it('detects_path_variants', async () => {
    const casos = [
      win('D:', 'PRINCIPAL', 'algo'),
      win('C:', '', 'Users', '', 'Fulano', '', 'x'), // barra escapada dentro de un string JS/JSON
      'C:/Users/Fulano/x',
      win('E:', 'Users', 'Mengano'),
      '/home/fulano/proyecto',
      '/Users/fulano/proyecto',
      'ver en "/home/zutano"',
    ]
    for (const [i, c] of casos.entries()) put(`p${i}.txt`, c)
    const v = await checkClean(dir, FORBIDDEN_RULES)
    expect(new Set(v.map(x => x.file)).size).toBe(casos.length)
  })

  it('does_not_flag_innocent_paths', async () => {
    put('ok.txt', 'import x from "./home/lib"; usa /usr/bin y ' + win('C:', 'Windows', 'System32') + '; src/Users.ts')
    expect(await checkClean(dir, FORBIDDEN_RULES)).toEqual([])
  })

  it('detects_email', async () => {
    put('a.txt', 'contacto: fulano@ejemplo.com')
    expect(await rulesHit()).toEqual(['email'])
  })

  it('detects_token_like', async () => {
    // Se arman en runtime para que el propio test no parezca un secreto.
    put('a.txt', 'k=' + 'sk-' + 'A1b2C3d4E5f6G7h8I9j0')
    put('b.txt', 'k=' + 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2')
    put('c.txt', 'k=' + 'ab12'.repeat(8))
    const v = await checkClean(dir, FORBIDDEN_RULES)
    expect(v.map(x => x.file).sort()).toEqual(['a.txt', 'b.txt', 'c.txt'])
    expect(new Set(v.map(x => x.rule))).toEqual(new Set(['token']))
  })

  it('detects_config_files', async () => {
    for (const n of ['.env', '.env.local', 'settings.json', 'config.json', 'sub/settings.json']) put(n, '{}')
    const v = await checkClean(dir, FORBIDDEN_RULES)
    expect(v.map(x => x.file).sort()).toEqual(['.env', '.env.local', 'config.json', 'settings.json', 'sub/settings.json'].sort())
    expect(new Set(v.map(x => x.rule))).toEqual(new Set(['archivo-config']))
  })

  it('ignores_binary_extensions', async () => {
    put('a.png', win('C:', 'Users', 'Fulano'))
    expect(await checkClean(dir, FORBIDDEN_RULES)).toEqual([])
  })

  it('clean_dir_passes', async () => {
    put('index.js', 'console.log("hola oficina")')
    put('sub/readme.md', '# Nada personal acá')
    expect(await checkClean(dir, FORBIDDEN_RULES)).toEqual([])
  })

  it('missing_dir_gives_empty', async () => {
    expect(await checkClean(join(dir, 'no-existe'), FORBIDDEN_RULES)).toEqual([])
  })

  it('custom_rules_are_used', async () => {
    put('a.txt', 'palabra-prohibida')
    const v = await checkClean(dir, [{ name: 'x', kind: 'content', pattern: /palabra-prohibida/ }])
    expect(v.map(x => x.rule)).toEqual(['x'])
  })
})
