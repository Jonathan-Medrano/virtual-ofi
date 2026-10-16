// Muebles voxel de la oficina, pintados con código (método de arte-voxel/fauna de la fábrica: Grid + malla greedy con color por
// vértice). 1 voxel = 1/16 m (VS). Cada modelo se arma centrado en x/z, apoyado en y = 0 y con el frente mirando a +z.
// Todo se hornea en LOD 1 (sin ruido de color: la paleta es chica a propósito, ver PAL).
import * as THREE from 'three';
import { Grid, gridGeometry, hash3, withGridLod } from '../vendor/kit3d';

/** Paleta chica de la oficina (pocos colores = poco ruido visual). */
export const PAL = {
  white: 0xe7e5e0,      // tapas de escritorio, tazas
  wall: 0xe3e2de,       // paredes
  black: 0x1e2023,      // techo, zócalo, monitores, sillas
  black2: 0x2b2e33,     // tapizado, detalles negros con algo de relieve
  grey: 0x5a6168,       // tapa del mueble de plantas
  metal: 0xa4a9ae,      // bandeja de cables
  wood: 0xbb9b77,       // madera del mueble y patas (roble claro)
  woodD: 0xa3825e,      // vetas y juntas de puertas
  osb: 0xcdaa74,        // columnas
  osbD: 0xbf9a66,       // astillas del OSB
  beige: 0xcdc3ad,      // separador de escritorio
  leaf: 0x3d7a3c,
  leafL: 0x67a24a,
  leafD: 0x2a5530,
  soil: 0x2a211b,
  screen: 0x7d9cba,     // pantalla encendida (glow)
  lamp: 0xffe1a6,       // boca de las lámparas (glow)
  sofa: 0x50565e,
} as const;

/** Hornea un modelo: grilla a malla en LOD 1. */
export function bake(draw: (g: Grid) => void, escala = 1): THREE.BufferGeometry {
  return withGridLod(1, () => { const g = new Grid(); draw(g); return gridGeometry(g, escala); });
}

/** Planta frondosa: hojas en tiras de 1 voxel que salen del centro (cx,cy,cz), suben y caen. Determinista por `seed`. */
export function drawPlant(g: Grid, cx: number, cy: number, cz: number, h: number, spread: number, seed: number, leaves = 9): void {
  for (let i = 0; i < leaves; i++) {
    const a = (i / leaves) * Math.PI * 2 + hash3(seed, i, 1) * 0.9;
    const len = spread * (0.6 + hash3(seed, i, 2) * 0.5);
    const top = h * (0.55 + hash3(seed, i, 3) * 0.45);
    const col = i % 3 === 0 ? PAL.leafL : i % 3 === 1 ? PAL.leaf : PAL.leafD;
    const steps = Math.max(4, Math.round(top + len));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      // sube rápido y se abre; la punta cae un poco
      const r = len * t;
      const y = cy + top * Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.5) - (t > 0.75 ? (t - 0.75) * top * 0.6 : 0);
      const x = Math.round(cx + Math.cos(a) * r), z = Math.round(cz + Math.sin(a) * r), yy = Math.round(y);
      g.dot(x, yy, z, col);
      // hoja ancha en el tramo del medio
      if (t > 0.35 && t < 0.85) { g.dot(x + (Math.abs(Math.sin(a)) > 0.7 ? 1 : 0), yy, z + (Math.abs(Math.sin(a)) > 0.7 ? 0 : 1), col); }
    }
  }
  g.box(cx - 1, cy, cz - 1, cx + 1, cy + Math.max(2, Math.round(h * 0.3)), cz + 1, PAL.leafD);
}

/** Isla de 4 puestos: mesa doble blanca con patas de madera, separador beige al medio y, por puesto, monitor, teclado, mouse y taza. */
export function deskGeometry(): THREE.BufferGeometry {
  return bake(g => {
    const X0 = -22, X1 = 23, Z = 12, TOP = 11;
    g.box(X0, TOP, -Z, X1, TOP + 1, Z, PAL.white);
    // caballetes de madera en las puntas
    for (const x of [X0 + 1, X1 - 3]) {
      for (const z of [-Z + 1, Z - 3]) g.box(x, 0, z, x + 2, TOP, z + 2, PAL.wood);
      g.box(x, 0, -Z + 1, x + 2, 1, Z - 1, PAL.wood);
      g.box(x, TOP - 1, -Z + 1, x + 2, TOP, Z - 1, PAL.wood);
    }
    // travesaño central bajo la tapa (rigidez)
    g.box(X0 + 3, TOP - 2, -1, X1 - 3, TOP, 1, PAL.wood);
    // separador
    g.box(X0 + 1, TOP + 1, 0, X1 - 1, TOP + 7, 1, PAL.beige);
    // puestos: x = ±11 voxeles (±0,7 m) del centro, a cada lado del separador
    let k = 0;
    for (const side of [1, -1]) for (const px of [-11, 11]) {
      const zf = side > 0 ? 2 : -2;            // primera fila después del separador
      const z = (o: number) => (side > 0 ? zf + o : zf - o);
      const zz = (o0: number, o1: number) => (side > 0 ? [z(o0), z(o1)] : [z(o1) + 1, z(o0) + 1]) as [number, number];
      // pie y brazo del monitor
      { const [a, b] = zz(0, 2); g.box(px - 2, TOP + 1, a, px + 2, TOP + 2, b, PAL.black); }
      { const [a, b] = zz(0, 1); g.box(px, TOP + 2, a, px + 1, TOP + 5, b, PAL.black2); }
      // pantalla: marco negro detrás, panel encendido adelante (mira a la silla)
      { const [a, b] = zz(1, 2); g.box(px - 5, TOP + 5, a, px + 5, TOP + 11, b, PAL.black); }
      { const [a, b] = zz(2, 3); g.box(px - 5, TOP + 5, a, px + 5, TOP + 11, b, PAL.black); g.box(px - 4, TOP + 6, a, px + 4, TOP + 10, b, PAL.screen, { glow: 1, j: 0 }); }
      // teclado, mouse y taza
      { const [a, b] = zz(5, 7); g.box(px - 3, TOP + 1, a, px + 3, TOP + 2, b, PAL.black2); }
      { const [a, b] = zz(6, 7); g.box(px + 5, TOP + 1, a, px + 6, TOP + 2, b, PAL.black2); }
      if (k % 2 === 0) { const [a, b] = zz(3, 4); g.box(px - 8, TOP + 1, a, px - 7, TOP + 3, b, PAL.white); g.dot(px - 8, TOP + 2, a, PAL.soil); }
      else { const [a, b] = zz(3, 5); g.box(px + 7, TOP + 1, a, px + 10, TOP + 2, b, PAL.white); }   // cuaderno
      k++;
    }
    // una plantita en una punta de la mesa
    g.box(X1 - 4, TOP + 1, -2, X1 - 2, TOP + 3, 0, PAL.white);
    drawPlant(g, X1 - 3, TOP + 3, -1, 4, 3, 7, 6);
  });
}

/** Silla de oficina negra (el que se sienta mira a +z). */
export function chairGeometry(): THREE.BufferGeometry {
  return bake(g => {
    // base de 4 rayos con ruedas
    g.box(-5, 0, 0, 6, 1, 1, PAL.black);
    g.box(0, 0, -5, 1, 1, 6, PAL.black);
    g.box(0, 1, 0, 1, 6, 1, PAL.metal);
    // asiento y respaldo
    g.box(-4, 6, -4, 5, 8, 5, PAL.black2);
    g.box(-4, 8, -5, 5, 17, -4, PAL.black);
    g.box(-1, 6, -5, 2, 8, -4, PAL.black);
    // apoyabrazos
    for (const x of [-5, 5]) { g.box(x, 8, -2, x + 1, 11, -1, PAL.black); g.box(x, 11, -3, x + 1, 12, 3, PAL.black); }
  });
}

/** Mueble delante de cada mesa: abajo madera con 3 puertas, arriba tapa gris con 3 huecos con plantas chicas. Frente a +z. */
export function cabinetGeometry(seed = 1): THREE.BufferGeometry {
  return bake(g => {
    const W = 12, D = 5;
    g.box(-W + 1, 0, -D + 1, W - 1, 1, D - 1, PAL.black);         // zócalo / ruedas
    g.box(-W, 1, -D, W, 12, D, PAL.wood);
    // juntas de las 3 puertas y manijas (en el frente y atrás)
    for (const zf of [D - 1, -D]) {
      for (const x of [-4, 4]) g.box(x, 1, zf, x + 1, 12, zf + 1, PAL.woodD);
      for (const x of [-6, 2, 9]) g.box(x, 9, zf, x + 1, 10, zf + 1, PAL.black);
      // vetas horizontales del roble (un solo tono, cerca del base: se lee madera sin hacer ruido)
      for (const y of [4, 8]) for (let x = -W; x < W; x++) if (x !== -4 && x !== 4) g.dot(x, y, zf, PAL.woodD);
    }
    // tapa gris gruesa
    g.box(-W, 12, -D, W, 15, D, PAL.grey);
    // 3 huecos con tierra y planta
    for (let i = 0; i < 3; i++) {
      const cx = -8 + i * 8;
      for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) if (x * x + z * z <= 9) { g.del(cx + x, 14, z); g.del(cx + x, 13, z); g.dot(cx + x, 12, z, PAL.soil); }
      drawPlant(g, cx, 13, 0, 4 + (i === 1 ? 2 : 0), 3, seed * 10 + i, 7);
    }
  });
}

/** Columna revestida en OSB, de piso a techo (alto en metros). */
export function columnGeometry(height: number): THREE.BufferGeometry {
  const H = Math.round(height * 16);
  return bake(g => {
    g.box(-5, 0, -4, 5, H, 4, PAL.osb);
    // astillas: virutas chicas de 1-3 voxeles en un solo tono (se lee como OSB, no como ladrillo)
    const flake = (x: number, y: number, z: number, ax: 'x' | 'z', seed: number) => {
      const h = hash3(x + seed, y, z);
      if (h > 0.13) return;
      const len = h < 0.04 ? 3 : h < 0.08 ? 2 : 1, vert = hash3(x, y + seed, z) < 0.4;
      for (let i = 0; i < len; i++) {
        const yy = vert ? y + i : y, u = vert ? 0 : i;
        if (yy >= H) break;
        if (ax === 'x') { if (x + u < 5) g.dot(x + u, yy, z, PAL.osbD); } else if (z + u < 4) g.dot(x, yy, z + u, PAL.osbD);
      }
    };
    for (let y = 0; y < H; y++) {
      for (let x = -5; x < 5; x++) for (const z of [-4, 3]) flake(x, y, z, 'x', 0);
      for (let z = -4; z < 4; z++) for (const x of [-5, 4]) flake(x, y, z, 'z', 31);
    }
  });
}

/** Planta en maceta negra, con tamaño (≈ alto en metros). */
export function plantGeometry(size: number, seed: number): THREE.BufferGeometry {
  const s = size;
  return bake(g => {
    const R = Math.max(3, Math.round(3 + s * 2)), PH = Math.round(5 + s * 4);
    for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) if (x * x + z * z <= R * R + 1) g.box(x, 0, z, x + 1, PH, z + 1, PAL.black2);
    for (let x = -R + 1; x < R; x++) for (let z = -R + 1; z < R; z++) if (x * x + z * z <= (R - 1) * (R - 1)) g.dot(x, PH - 1, z, PAL.soil);
    drawPlant(g, 0, PH, 0, Math.round(10 + s * 14), Math.round(5 + s * 6), seed, 12 + Math.round(s * 4));
  });
}

/** Maceta baja y ancha del centro del pasillo, con una planta grande. */
export function planterGeometry(seed: number): THREE.BufferGeometry {
  return bake(g => {
    g.box(-5, 0, -5, 6, 7, 6, PAL.black2);
    g.box(-4, 6, -4, 5, 7, 5, PAL.soil);
    drawPlant(g, 0, 7, 0, 10, 6, seed, 13);
    drawPlant(g, 3, 7, -3, 6, 4, seed + 5, 6);
  });
}

/** Banco tapizado SIN respaldo (largo a lo largo de x del modelo): 1 × 0,42 m, asiento a 0,45 m, patas negras. */
export function benchGeometry(): THREE.BufferGeometry {
  return bake(g => {
    for (const x of [-8, 7]) for (const z of [-3, 2]) g.box(x, 0, z, x + 1, 3, z + 1, PAL.black);
    g.box(-8, 3, -3, 8, 4, 3, PAL.black);                   // bastidor
    g.box(-8, 4, -3, 8, 7, 3, PAL.sofa);                    // almohadón
    g.box(0, 6, -3, 1, 7, 3, PAL.black2);                   // costura al medio (2 lugares)
  });
}

/** Lámpara colgante negra (pantalla en escalones); la boca encendida queda en y = 0, el cable sube `cable` metros. */
export function lampGeometry(cable: number): THREE.BufferGeometry {
  const C = Math.round(cable * 16);
  return bake(g => {
    const rings = [6, 6, 6, 5, 4, 3, 1];
    rings.forEach((r, i) => {
      for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) if (x * x + z * z <= r * r + 1) g.dot(x, i, z, PAL.black);
    });
    for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) if (x * x + z * z <= 26) g.dot(x, 0, z, PAL.lamp, 1);
    g.box(0, 7, 0, 1, 7 + C, 1, PAL.black);
  });
}
