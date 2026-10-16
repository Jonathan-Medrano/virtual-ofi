// Capturas reales de la oficina (como tools/shot.mjs de la fábrica): levanta vite EN ESTE proceso (puerto libre, se cierra solo),
// abre office/dev.html en Chromium y guarda un PNG por vista. Imprime draw calls, triángulos y fps de cada una.
// Uso: node tools/shot.mjs [carpeta-salida=docs/capturas] [vistas=entrada,isla,fondo] [--seats] [--w=1280] [--h=720]
// Ojo: los fps de Chromium headless (render por software) NO representan una GPU integrada; draw calls y triángulos sí.
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n, d) => { const a = args.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d; };
const [outDir = 'docs/capturas', views = 'entrada,isla,fondo'] = args.filter(a => !a.startsWith('--'));
const seats = args.includes('--seats');
const W = Number(flag('w', 1280)), H = Number(flag('h', 720));
const prefix = flag('prefix', 'oficina');

await mkdir(path.resolve(ROOT, outDir), { recursive: true });
const server = await createServer({ root: ROOT, configFile: false, logLevel: 'error', server: { port: 0, host: '127.0.0.1' } });
await server.listen();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => m.type() === 'error' && errs.push(m.text()));
  for (const v of views.split(',')) {
    await page.goto(`${server.resolvedUrls.local[0]}office/dev.html?shot&cam=${v}${seats ? '&seats' : ''}`);
    await page.waitForFunction(() => window.__ofi?.ready, null, { timeout: 30000 });
    await page.waitForTimeout(2500);   // amortiguación de la cámara y una ventana de fps
    const st = await page.evaluate(() => ({ ...window.__ofi }));
    const file = path.join(outDir, `${prefix}-${v}${seats ? '-puestos' : ''}.png`);
    await page.screenshot({ path: path.resolve(ROOT, file) });
    results.push({ vista: v, archivo: file.split(path.sep).join('/'), drawCalls: st.calls, triangulos: st.triangles, fpsHeadless: st.fps, armadoMs: st.buildMs });
  }
  if (errs.length) throw new Error('errores en la página: ' + errs.join(' | '));
  console.table(results);
} finally {
  await browser.close();
  await server.close();
}
