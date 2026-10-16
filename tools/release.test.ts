import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertReleasable } from './release.mjs'

// Datos inventados; la función es pura respecto de la red: no publica nada.
const BS = String.fromCharCode(92)
let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ofi-rel-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('assertReleasable', () => {
  it('release_blocks_if_check_clean_fails', async () => {
    writeFileSync(join(dir, 'trampa.js'), 'const p = "' + ['C:', 'Users', 'Fulano', 'x'].join(BS + BS) + '"')
    await expect(assertReleasable(dir)).rejects.toThrow(/violaci/i)
  })

  it('release_allows_clean_dir', async () => {
    writeFileSync(join(dir, 'ok.js'), 'console.log("hola")')
    await expect(assertReleasable(dir)).resolves.toBeUndefined()
  })
})
