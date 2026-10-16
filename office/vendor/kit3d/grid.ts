// COPIA GENERADA por tools/vendor-kit3d.mjs desde fabrica/kit3d/src/voxel/grid.ts. No editar a mano: re-correr el script.
// Núcleo voxel portado de Holdout (prototipos/holdout3d/vox.js): modelos pintados voxel por voxel, sin GLB.
//   - 1 voxel = 1/16 de unidad (VS). Un humano mide ~32 voxeles (2 unidades).
//   - Cada pieza se funde en UNA geometría con color por vértice (caras ocultas descartadas, sombreado horneado por cara).
//   - Los voxeles "glow" no se sombrean (ojos, núcleos): salen más brillantes.
// Coordenadas: x derecha, y arriba, z ADELANTE (la cara mira a +z).
import * as THREE from 'three';

/** Tamaño de un voxel en unidades del mundo. */
export const VS = 1 / 16;

/** Paleta compartida (biopunk militar). */
export const PAL = {
  skin: 0x7d8f5a, skinD: 0x5a6b40, skinL: 0x93a56c, flesh: 0x8a4a4a, raw: 0x9a3a52, rawD: 0x6e2438, bone: 0xd8cfb4, boneD: 0xa89f84,
  acid: 0x9dff3a, vio: 0x5e2f7a, vio2: 0x8a4aa8, rust: 0x8a4a2a, rustD: 0x5e321c, steel: 0x7f8a94, steelD: 0x505964, dark: 0x23262b,
  cloth: 0x4a4f6a, clothD: 0x33374c, shirt: 0x9a4a4a, shirtD: 0x6e3434, amber: 0xe0a02a, chit: 0x3a2f24, chitL: 0x5e4a34,
} as const;

/**
 * LOD de la grilla: 0 = detalle completo (retratos, vitrina); 1 = el de partida: sin ruido de color ni manchas sueltas
 * (a ese tamaño no se ven) y las caras se funden en rectángulos grandes: ~4x menos triángulos. 2 = gama baja: además la grilla se
 * engrosa a voxeles de 2×2×2 (`coarsen`, ver `rig`): otro ~2-3x menos triángulos con la misma silueta. 3 = como 2 pero el engrosado
 * conserva los rasgos claros y las marcas de color (`coarsen(g, true)`): el de los jefes en gama baja.
 */
let LOD = 0;

/** Corre `fn` con el LOD indicado y restaura el anterior. */
export function withGridLod<T>(n: number, fn: () => T): T {
  const o = LOD;
  LOD = n;
  try { return fn(); } finally { LOD = o; }
}

/** Hash determinista de una celda → [0, 1). */
export function hash3(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export interface Voxel { x: number; y: number; z: number; c: THREE.Color; glow: number }
export type ColorFn = (x: number, y: number, z: number) => THREE.ColorRepresentation;

export class Grid {
  readonly v = new Map<number, Voxel>();

  key(x: number, y: number, z: number): number { return (x + 128) | ((y + 128) << 8) | ((z + 128) << 16); }

  set(x: number, y: number, z: number, col: THREE.ColorRepresentation, glow = 0, j = 0.1): void {
    const c = new THREE.Color(col);
    if (!glow && j && !LOD) {
      const h = hash3(x, y, z);
      c.multiplyScalar(h < 0.18 ? 1 - j * 0.9 : h > 0.82 ? 1 + j * 0.9 : 1);
    }
    this.v.set(this.key(x, y, z), { x, y, z, c, glow });
  }

  del(x: number, y: number, z: number): void { this.v.delete(this.key(x, y, z)); }

  has(x: number, y: number, z: number): boolean { return this.v.has(this.key(x, y, z)); }

  /** Cantidad de voxeles. */
  get size(): number { return this.v.size; }

  /** Caja [x0,x1) × [y0,y1) × [z0,z1); `col` puede ser una función (x,y,z) => color. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, col: THREE.ColorRepresentation | ColorFn, o: { glow?: number; j?: number } = {}): this {
    for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) {
      this.set(x, y, z, typeof col === 'function' ? col(x, y, z) : col, o.glow ?? 0, o.j ?? 0.1);
    }
    return this;
  }

  dot(x: number, y: number, z: number, col: THREE.ColorRepresentation, glow = 0): this { this.set(x, y, z, col, glow, 0); return this; }

  /** Salpicado: cambia un % `p` de los voxeles existentes de la caja por otro color (moho, pústulas, manchas). */
  speckle(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, col: THREE.ColorRepresentation, p: number, seed = 1, glow = 0): this {
    if (LOD && !glow) return this;
    for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) {
      if (this.has(x, y, z) && hash3(x + seed * 7, y + seed * 13, z + seed * 29) < p) this.set(x, y, z, col, glow, glow ? 0 : 0.1);
    }
    return this;
  }

  carve(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): this {
    for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) this.del(x, y, z);
    return this;
  }

  /** Geometría fundida con color por vértice (ver gridGeometry). */
  toGeometry(): THREE.BufferGeometry { return gridGeometry(this); }
}

// Brillo horneado por dirección: +x -x +y -y +z -z.
const SHADE = [0.78, 0.68, 1.0, 0.5, 0.9, 0.62];
// [eje, signo]
const DIRS: ReadonlyArray<readonly [number, number]> = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];

interface Cell { u: number; v: number; c: THREE.Color; glow: number; key: number }

/**
 * Versión con mapas (sin volumen denso): es la definición de referencia de `gridGeometry` (los tests comparan byte a byte) y el plan B
 * cuando la caja que envuelve a la grilla es enorme. Malla "greedy": descarta las caras ocultas y funde las visibles del mismo color y la
 * misma dirección en rectángulos. Atributos: position, color (con el sombreado horneado), normal, glow.
 */
export function gridGeometryDispersa(g: Grid, escala = 1): THREE.BufferGeometry {
  const S = VS * escala;
  const pos: number[] = [], col: number[] = [], idx: number[] = [], gl: number[] = [], nor: number[] = [];
  const emit = (a: number, sg: number, slice: number, u0: number, v0: number, u1: number, v1: number, c: THREE.Color, glow: number, di: number) => {
    const ua = (a + 1) % 3, va = (a + 2) % 3;
    const P = (u: number, v: number): number[] => { const o = [0, 0, 0]; o[a] = slice; o[ua] = u; o[va] = v; return o; };
    let q = [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)];
    const e1 = [q[1]![0]! - q[0]![0]!, q[1]![1]! - q[0]![1]!, q[1]![2]! - q[0]![2]!];
    const e2 = [q[3]![0]! - q[0]![0]!, q[3]![1]! - q[0]![1]!, q[3]![2]! - q[0]![2]!];
    const cr = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    if (cr[a]! * sg < 0) q = [q[0]!, q[3]!, q[2]!, q[1]!];
    const k = glow ? 1.15 : SHADE[di]!, base = pos.length / 3, n = [0, 0, 0];
    n[a] = sg;
    for (const p of q) {
      pos.push(p[0]! * S, p[1]! * S, p[2]! * S);
      col.push(c.r * k, c.g * k, c.b * k);
      gl.push(glow ? 1 : 0);
      nor.push(n[0]!, n[1]!, n[2]!);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  DIRS.forEach(([a, sg], di) => {
    const ua = (a + 1) % 3, va = (a + 2) % 3;
    const slices = new Map<number, Map<number, Cell>>();
    for (const vx of g.v.values()) {
      const co = [vx.x, vx.y, vx.z], nb = [vx.x, vx.y, vx.z];
      nb[a]! += sg;
      if (g.has(nb[0]!, nb[1]!, nb[2]!)) continue;
      const sl = co[a]! + (sg > 0 ? 1 : 0);
      let m = slices.get(sl);
      if (!m) slices.set(sl, m = new Map());
      m.set(co[ua]! * 4096 + co[va]! + 2048, { u: co[ua]!, v: co[va]!, c: vx.c, glow: vx.glow, key: vx.c.getHex() + (vx.glow ? 0x1000000 : 0) });
    }
    for (const [sl, m] of slices) {
      const done = new Set<number>();
      const at = (u: number, v: number) => m.get(u * 4096 + v + 2048);
      const cells = [...m.values()].sort((p1, p2) => p1.v - p2.v || p1.u - p2.u);
      for (const f of cells) {
        const id = f.u * 4096 + f.v + 2048;
        if (done.has(id)) continue;
        let w = 1;
        for (;;) {
          const o = at(f.u + w, f.v);
          if (!o || o.key !== f.key || done.has((f.u + w) * 4096 + f.v + 2048)) break;
          w++;
        }
        let h = 1, grow = true;
        while (grow) {
          for (let i = 0; i < w; i++) {
            const o = at(f.u + i, f.v + h);
            if (!o || o.key !== f.key || done.has((f.u + i) * 4096 + f.v + h + 2048)) { grow = false; break; }
          }
          if (grow) h++;
        }
        for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) done.add((f.u + i) * 4096 + f.v + j + 2048);
        emit(a, sg, sl, f.u, f.v, f.u + w, f.v + h, f.c, f.glow, di);
      }
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('glow', new THREE.Float32BufferAttribute(gl, 1));
  geo.setIndex(idx);
  return geo;
}

/** Por encima de este volumen (celdas de la caja envolvente) `gridGeometry` usa la versión con mapas en vez de arreglos densos. */
const MAX_VOLUMEN_DENSO = 4_000_000;

/**
 * Malla "greedy" (ver `gridGeometryDispersa`, de la que es idéntica bit a bit) sobre arreglos densos: la grilla se vuelca a un volumen
 * de enteros, cada dirección arma una máscara por rebanada y el fundido recorre filas y columnas en el mismo orden que el ordenamiento
 * por (v, u) de la versión con mapas. Sin Map/Set ni objetos por cara: es el camino más caliente del arranque (cada modelo, cada pieza,
 * cada LOD, la escenografía del menú y de la intro).
 */
export function gridGeometry(g: Grid, escala = 1): THREE.BufferGeometry {
  const vox = Array.from(g.v.values()), nv = vox.length;
  if (!nv) return gridGeometryDispersa(g, escala);
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < nv; i++) {
    const v = vox[i]!;
    if (v.x < x0) x0 = v.x; if (v.x > x1) x1 = v.x;
    if (v.y < y0) y0 = v.y; if (v.y > y1) y1 = v.y;
    if (v.z < z0) z0 = v.z; if (v.z > z1) z1 = v.z;
  }
  const nx = x1 - x0 + 1, ny = y1 - y0 + 1, nz = z1 - z0 + 1;
  if (nx * ny * nz > MAX_VOLUMEN_DENSO) return gridGeometryDispersa(g, escala);
  const S = VS * escala;
  const pos: number[] = [], col: number[] = [], idx: number[] = [], gl: number[] = [], nor: number[] = [];
  // clave de color por voxel (`getHex` convierte de espacio de color: se calcula UNA vez, no una por dirección) y volumen de ocupación (índice + 1)
  const keys = new Int32Array(nv), occ = new Int32Array(nx * ny * nz);
  for (let i = 0; i < nv; i++) {
    const v = vox[i]!;
    keys[i] = v.c.getHex() + (v.glow ? 0x1000000 : 0);
    occ[(v.x - x0) + nx * ((v.y - y0) + ny * (v.z - z0))] = i + 1;
  }
  const lo = [x0, y0, z0], dim = [nx, ny, nz];
  const emit = (a: number, sg: number, slice: number, u0: number, v0: number, u1: number, v1: number, c: THREE.Color, glow: number, di: number): void => {
    const ua = (a + 1) % 3;
    const k = glow ? 1.15 : SHADE[di]!, base = pos.length / 3;
    const r = c.r * k, gg = c.g * k, b = c.b * k, gv = glow ? 1 : 0;
    const nx_ = a === 0 ? sg : 0, ny_ = a === 1 ? sg : 0, nz_ = a === 2 ? sg : 0;
    for (let n = 0; n < 4; n++) {
      // ejes cíclicos (ua × va = +a): con sg > 0 el rectángulo sale (u0,v0) (u1,v0) (u1,v1) (u0,v1); con sg < 0 se invierte el sentido
      const usaU1 = sg > 0 ? n === 1 || n === 2 : n === 3 || n === 2;
      const usaV1 = sg > 0 ? n === 2 || n === 3 : n === 1 || n === 2;
      const u = usaU1 ? u1 : u0, v = usaV1 ? v1 : v0;
      pos.push((a === 0 ? slice : ua === 0 ? u : v) * S, (a === 1 ? slice : ua === 1 ? u : v) * S, (a === 2 ? slice : ua === 2 ? u : v) * S);
      col.push(r, gg, b);
      gl.push(gv);
      nor.push(nx_, ny_, nz_);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (let di = 0; di < 6; di++) {
    const a = DIRS[di]![0], sg = DIRS[di]![1], ua = (a + 1) % 3, va = (a + 2) % 3;
    const aN = dim[a]!, uN = dim[ua]!, vN = dim[va]!, aMin = lo[a]!, uMin = lo[ua]!, vMin = lo[va]!;
    const plano = uN * vN;
    const mask = new Int32Array(aN * plano), done = new Uint8Array(aN * plano), visto = new Uint8Array(aN);
    const orden: number[] = [];   // rebanadas en el orden en que aparecen al recorrer los voxeles (igual que la versión con mapas)
    const dx = a === 0 ? sg : 0, dy = a === 1 ? sg : 0, dz = a === 2 ? sg : 0;
    for (let i = 0; i < nv; i++) {
      const v = vox[i]!;
      const x = v.x - x0, y = v.y - y0, z = v.z - z0, nbx = x + dx, nby = y + dy, nbz = z + dz;
      if (nbx >= 0 && nbx < nx && nby >= 0 && nby < ny && nbz >= 0 && nbz < nz && occ[nbx + nx * (nby + ny * nbz)] !== 0) continue;
      const ca = a === 0 ? x : a === 1 ? y : z, cu = ua === 0 ? x : ua === 1 ? y : z, cv = va === 0 ? x : va === 1 ? y : z;
      mask[ca * plano + cv * uN + cu] = i + 1;
      if (!visto[ca]) { visto[ca] = 1; orden.push(ca); }
    }
    for (let oi = 0; oi < orden.length; oi++) {
      const layer = orden[oi]!, base = layer * plano;
      for (let v = 0; v < vN; v++) for (let u = 0; u < uN; u++) {
        const id = base + v * uN + u, m = mask[id]!;
        if (m === 0 || done[id]) continue;
        const key = keys[m - 1]!;
        let w = 1;
        while (u + w < uN) { const m2 = mask[id + w]!; if (m2 === 0 || keys[m2 - 1] !== key || done[id + w]) break; w++; }
        let h = 1;
        for (; v + h < vN; h++) {
          const row = id + h * uN;
          let ok = true;
          for (let i = 0; i < w; i++) { const m2 = mask[row + i]!; if (m2 === 0 || keys[m2 - 1] !== key || done[row + i]) { ok = false; break; } }
          if (!ok) break;
        }
        for (let j = 0; j < h; j++) { const row = id + j * uN; for (let i = 0; i < w; i++) done[row + i] = 1; }
        const f = vox[m - 1]!;
        emit(a, sg, layer + aMin + (sg > 0 ? 1 : 0), u + uMin, v + vMin, u + uMin + w, v + vMin + h, f.c, f.glow, di);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('glow', new THREE.Float32BufferAttribute(gl, 1));
  geo.setIndex(idx);
  return geo;
}

/**
 * Engrosa la grilla a voxeles de 2×2×2: cada celda de 8 voxeles pasa a ser uno del color más frecuente (los brillantes mandan), y solo
 * existe si tiene al menos 3 de los 8 (lo suelto de 1 voxel desaparece; ojos y núcleos `glow` siempre quedan). Coordenadas = floor(x/2);
 * la geometría se arma con `gridGeometry(coarse, 2)`.
 */
export function coarsen(g: Grid, rasgos = false): Grid {
  if (rasgos) return coarsenRasgos(g);
  interface Acc { x: number; y: number; z: number; n: number; glow: Voxel | null; cols: Map<number, { c: THREE.Color; n: number }> }
  const acc = new Map<number, Acc>();
  const out = new Grid();
  for (const v of g.v.values()) {
    const cx = Math.floor(v.x / 2), cy = Math.floor(v.y / 2), cz = Math.floor(v.z / 2), k = out.key(cx, cy, cz);
    let a = acc.get(k);
    if (!a) acc.set(k, a = { x: cx, y: cy, z: cz, n: 0, glow: null, cols: new Map() });
    a.n++;
    if (v.glow && !a.glow) a.glow = v;
    const hex = v.c.getHex(), e = a.cols.get(hex);
    if (e) e.n++; else a.cols.set(hex, { c: v.c, n: 1 });
  }
  for (const [k, a] of acc) {
    if (a.n < 3 && !a.glow) continue;
    let best: { c: THREE.Color; n: number } | null = null;
    // El más frecuente, con un sesgo hacia lo oscuro: los voxeles oscuros son los contornos y las sombras que despegan al bicho del fondo.
    let bestW = -1;
    for (const e of a.cols.values()) { const w = e.n * (1.6 - (0.2126 * e.c.r + 0.7152 * e.c.g + 0.0722 * e.c.b)); if (w > bestW) { bestW = w; best = e; } }
    out.v.set(k, { x: a.x, y: a.y, z: a.z, c: a.glow ? a.glow.c : best!.c, glow: a.glow ? a.glow.glow : 0 });
  }
  return out;
}

const luma = (c: THREE.Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/**
 * `coarsen` que conserva los RASGOS (jefes en gama baja): dientes, cuernos, púas, crestas y huesos son tiras de 1 voxel claro sobre un
 * cuerpo oscuro, y el engrosado común los borra (celdas con < 3 voxeles) o los tapa (el voto con sesgo a lo oscuro). Acá:
 *  - una celda del borde (≤ 5 de 8) que tiene un voxel claro que resalta sobre el color dominante toma ESE color (la fila de dientes,
 *    la punta del cuerno y las púas quedan, en grueso);
 *  - una celda finita (1-3 de 8) sobrevive solo si es un rasgo claro; las celdas llenas toman el color mayoritario (sin rayitas oscuras
 *    que parten las caras fundidas). Lo uno paga lo otro: +4..15 % de triángulos sobre `coarsen` en los jefes del catálogo.
 */
function coarsenRasgos(g: Grid): Grid {
  interface Acc { x: number; y: number; z: number; n: number; glow: Voxel | null; cols: Map<number, { c: THREE.Color; n: number }> }
  const acc = new Map<number, Acc>();
  const out = new Grid();
  for (const v of g.v.values()) {
    const cx = Math.floor(v.x / 2), cy = Math.floor(v.y / 2), cz = Math.floor(v.z / 2), k = out.key(cx, cy, cz);
    let a = acc.get(k);
    if (!a) acc.set(k, a = { x: cx, y: cy, z: cz, n: 0, glow: null, cols: new Map() });
    a.n++;
    if (v.glow && !a.glow) a.glow = v;
    const hex = v.c.getHex(), e = a.cols.get(hex);
    if (e) e.n++; else a.cols.set(hex, { c: v.c, n: 1 });
  }
  for (const [k, a] of acc) {
    let best: { c: THREE.Color; n: number } | null = null, bestW = -1;
    const sesgo = a.n >= 6 ? 0 : 1;   // celda llena (interior): el color mayoritario, sin rayitas oscuras que parten las caras fundidas
    for (const e of a.cols.values()) { const w = e.n * (1 + sesgo * (0.6 - luma(e.c))); if (w > bestW) { bestW = w; best = e; } }
    const lb = luma(best!.c);
    let rasgo: THREE.Color | null = null, lr = Math.max(0.3, lb * 2.2 + 0.08);
    for (const e of a.cols.values()) { const l = luma(e.c); if (l >= lr) { lr = l; rasgo = e.c; } }
    // Celda finita (1-3 de 8): sobrevive solo si brilla o es un rasgo claro (diente, cuerno, púa); un voxel o dos claros sueltos también.
    if (a.n < 4 && !a.glow && !rasgo && (a.n >= 3 || lb < 0.45)) continue;
    // Marca de color (zarpazo rojo, cresta naranja sobre verde): un color bien saturado que resalta sobre el dominante, con ≥ 3 voxeles de la celda.
    let marca: THREE.Color | null = null;
    if (!rasgo) {
      const sd = sat(best!.c);
      let sm = Math.max(0.5, sd + 0.2);
      for (const e of a.cols.values()) { const s = sat(e.c); if (e.n >= 3 && s >= sm) { sm = s; marca = e.c; } }
    }
    const c = a.glow ? a.glow.c : rasgo && a.n <= 5 ? rasgo : marca ?? best!.c;
    out.v.set(k, { x: a.x, y: a.y, z: a.z, c, glow: a.glow ? a.glow.glow : 0 });
  }
  return out;
}

const HSL = { h: 0, s: 0, l: 0 };
/** Saturación HSL (en el espacio de trabajo de three). */
const sat = (c: THREE.Color): number => c.getHSL(HSL).s * Math.min(1, HSL.l * 4);

/** Triángulos de una geometría indexada. */
export function triangleCount(geo: THREE.BufferGeometry): number {
  return (geo.index ? geo.index.count : geo.getAttribute('position').count) / 3;
}
