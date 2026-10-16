// Compila la cáscara con esbuild (viene con vite): main y preload a CommonJS (Electron los carga así),
// y el renderer a un solo script para el navegador. Salida en dist-shell/ (ignorada por git).
import { build } from 'esbuild'
import fs from 'node:fs'

const out = 'dist-shell'
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out + '/renderer', { recursive: true })

const common = { bundle: true, sourcemap: false, logLevel: 'warning' }
await build({ ...common, entryPoints: ['shell/main.ts'], outfile: out + '/main.cjs', platform: 'node', format: 'cjs', external: ['electron'], target: 'node22' })
await build({ ...common, entryPoints: ['shell/preload.ts'], outfile: out + '/preload.cjs', platform: 'node', format: 'cjs', external: ['electron'], target: 'node22' })
await build({ ...common, entryPoints: ['shell/renderer/main.ts'], outfile: out + '/renderer/main.js', platform: 'browser', format: 'iife', target: 'chrome130', minify: true })
fs.copyFileSync('shell/renderer/index.html', out + '/renderer/index.html')
console.log('shell compilado en', out)
