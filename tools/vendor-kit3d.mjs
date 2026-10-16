// Copia las piezas de kit3d de la fábrica de juegos que usa la oficina a office/vendor/kit3d/ (reproducible, no a mano).
// Uso: node tools/vendor-kit3d.mjs <carpeta-de-la-fabrica>    (o FABRICA_DIR=<carpeta> node tools/vendor-kit3d.mjs)
// La ruta de la fábrica NO se guarda en ningún lado (el repo es público): solo queda la ruta relativa dentro de la fábrica.
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'office', 'vendor', 'kit3d');

/** Lista blanca: archivo de la fábrica (relativo a kit3d/src) → destino. Solo código; los tests quedan en la fábrica. */
export const FILES = [
  ['voxel/grid.ts', 'grid.ts'],      // grilla voxel + malla greedy con color por vértice (método de arte-voxel/fauna)
  ['outline.ts', 'outline.ts'],      // contornos por casco invertido
  ['dispose.ts', 'dispose.ts'],      // liberar un árbol de three
  ['quality.ts', 'quality.ts'],      // gobernador de fps (calidad adaptativa)
];

/**
 * Reescrituras de imports para que compile sin los paquetes de la fábrica: [regex, reemplazo]. Hoy ninguna de las piezas
 * copiadas importa `@fabrica/*` (solo `three`); si se suma una que sí, el chequeo de abajo frena la copia hasta agregarla acá.
 */
const REWRITES = [];

export async function vendor(fabricaDir) {
  const src = path.join(fabricaDir, 'kit3d', 'src');
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const exportsLines = [];
  for (const [from, to] of FILES) {
    let text = await readFile(path.join(src, from), 'utf8');
    for (const [re, rep] of REWRITES) text = text.replace(re, rep);
    if (/from '@fabrica\//.test(text)) throw new Error(`${from} importa un paquete de la fábrica: agregá una reescritura`);
    const header = `// COPIA GENERADA por tools/vendor-kit3d.mjs desde fabrica/kit3d/src/${from}. No editar a mano: re-correr el script.\n`;
    await writeFile(path.join(OUT, to), header + text);
    exportsLines.push(`export * from './${to.replace(/\.ts$/, '')}';`);
  }
  await writeFile(path.join(OUT, 'index.ts'), `// COPIA GENERADA por tools/vendor-kit3d.mjs. No editar a mano.\n${exportsLines.join('\n')}\n`);
  return FILES.map(f => f[1]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? process.env.FABRICA_DIR;
  if (!dir) { console.error('uso: node tools/vendor-kit3d.mjs <carpeta-de-la-fabrica>  (o FABRICA_DIR=...)'); process.exit(2); }
  const files = await vendor(path.resolve(dir));
  console.log(`kit3d copiado a office/vendor/kit3d: ${files.join(', ')}`);
}
