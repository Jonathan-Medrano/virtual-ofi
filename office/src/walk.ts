// Modo recorrido: el jugador en primera persona. Lógica pura (sin three ni DOM), testeable.
//
// - Movimiento: WASD/flechas en el plano del piso según hacia dónde mira (yaw), Shift corre. Sin aceleración ni cabeceo de
//   cámara (marea). Se avanza en pasos cortos (≤ 5 cm) para no "saltar" un mueble angosto con un frame lento.
// - Colisión: el jugador es un círculo de radio `PLAYER_RADIUS` en planta contra los rectángulos de los muebles (los mismos
//   de `behavior.ts`: `rectsOf(officeLayout().props)`), los personajes sentados (círculos) y el rectángulo del salón.
//   Después de mover, se empuja el círculo afuera de lo que pisa por el punto más cercano de cada rectángulo: eso desliza
//   a lo largo de paredes y bordes en vez de frenar en seco. Varias pasadas resuelven los rincones (dos cosas empujando a la
//   vez); si aun así quedara superpuesto, ese paso se descarta (nunca queda adentro de nada, así que nunca se traba).
// - Mira: yaw libre, pitch con tope (`PITCH_LIMIT`) para no dar la vuelta mirando arriba/abajo.
import { officeLayout, ROOM, DOOR, type Prop } from './layout';
import { CHAR_RADIUS, rectsOf, type P, type Rect } from './behavior';

/** Altura de los ojos. Los personajes miden 1,48 m (ojos a 1,29): a 1,45 se ve como alguien un poco más alto que ellos. */
export const EYE_HEIGHT = 1.45;
/** m/s caminando y corriendo. */
export const WALK_SPEED_P = 1.6;
export const RUN_SPEED_P = 3.0;
/** Radio del jugador en planta: el mismo que el de los personajes. */
export const PLAYER_RADIUS = CHAR_RADIUS;
/** Tope de mirar arriba/abajo (~77°). */
export const PITCH_LIMIT = 1.35;
/** Hasta dónde se puede "apuntar" a alguien para ver su cartel. */
export const TARGET_RANGE = 6;
const TARGET_RADIUS = 0.35;       // radio del cilindro que representa a un personaje al apuntar
const TARGET_HEAD_SLACK = 0.35;   // margen arriba de la cabeza: mirando derecho a un sentado igual lo toma
const MAX_SUBSTEP = 0.05;
const EPS = 1e-6;

export interface PlayerState { x: number; z: number; yaw: number; pitch: number }

/**
 * Entrada de un frame. `forward`/`strafe` en -1..1 (strafe + = derecha). `lookYaw`/`lookPitch` en radianes ya escalados
 * (mouse a la derecha = yaw negativo; mouse arriba = pitch positivo).
 */
export interface WalkInput { forward: number; strafe: number; run: boolean; lookYaw: number; lookPitch: number }
export const NO_INPUT: WalkInput = { forward: 0, strafe: 0, run: false, lookYaw: 0, lookPitch: 0 };

export interface Bounds { x0: number; x1: number; z0: number; z1: number }
export interface WalkWorld {
  rects: Rect[];
  /** Personas que no se atraviesan (los sentados): centro en planta, radio `CHAR_RADIUS`. */
  people?: P[];
  /** Rectángulo del que no se sale (el centro del jugador queda a `PLAYER_RADIUS` de sus bordes). */
  bounds: Bounds;
}

/**
 * El mundo del recorrido: los muebles del plano y el salón. La entrada es una puerta de vidrio cerrada pintada en la pared
 * (x = 0): del otro lado no hay piso ni nada modelado, así que el borde es el umbral (se puede llegar hasta la puerta).
 */
export function walkWorld(people: P[] = []): WalkWorld {
  return {
    rects: rectsOf(officeLayout().props.map(foliage)),
    people,
    bounds: { x0: 0, x1: ROOM.length, z0: -ROOM.width / 2, z1: ROOM.width / 2 },
  };
}

/**
 * Las hojas de las plantas salen bastante más que la maceta (que es lo que mide el plano, para que los personajes pasen
 * cerca): a la altura de los ojos la cámara quedaría metida entre las hojas. Para el jugador se agranda la planta hasta su
 * copa: radio de la copa en furniture.ts = (5 + 6·tamaño) vóxeles de 1/16 m, más un margen.
 */
const FOLIAGE_PAD = 0.2, PLANTER_HALF = 0.5;
function foliage(p: Prop): Prop {
  if (p.kind === 'plant') {
    const half = Math.max(p.w / 2, (5 + 6 * (p.size ?? 1)) / 16 + FOLIAGE_PAD - PLAYER_RADIUS);
    return { ...p, w: half * 2, d: half * 2 };
  }
  if (p.kind === 'planter') return { ...p, w: Math.max(p.w, PLANTER_HALF * 2), d: Math.max(p.d, PLANTER_HALF * 2) };
  return p;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** ¿El jugador en (x, z) no pisa nada? (con una tolerancia mínima: quedar tocando un borde está bien) */
export function playerFree(p: { x: number; z: number }, w: WalkWorld): boolean {
  const R = PLAYER_RADIUS - EPS * 10;
  const b = w.bounds;
  if (p.x < b.x0 + R || p.x > b.x1 - R || p.z < b.z0 + R || p.z > b.z1 - R) return false;
  for (const r of w.rects) {
    const dx = p.x - clamp(p.x, r.x0, r.x1), dz = p.z - clamp(p.z, r.z0, r.z1);
    if (dx * dx + dz * dz < R * R) return false;
  }
  const RP = R + CHAR_RADIUS;
  for (const o of w.people ?? []) if ((p.x - o.x) ** 2 + (p.z - o.z) ** 2 < RP * RP) return false;
  return true;
}

/** Empuja el círculo afuera de todo lo que pisa (varias pasadas, por los rincones). Devuelve la posición corregida. */
function pushOut(x: number, z: number, w: WalkWorld): P {
  const R = PLAYER_RADIUS, b = w.bounds;
  for (let it = 0; it < 6; it++) {
    let moved = false;
    for (const r of w.rects) {
      const cx = clamp(x, r.x0, r.x1), cz = clamp(z, r.z0, r.z1);
      const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= R * R) continue;
      moved = true;
      if (d2 > 1e-12) {
        const d = Math.sqrt(d2), k = (R - d) / d;
        x += dx * k; z += dz * k;
      } else {
        // el centro quedó adentro del rectángulo: sale por el lado más cercano
        const opts: Array<[number, number, number]> = [
          [x - r.x0, r.x0 - R - x, 0], [r.x1 - x, r.x1 + R - x, 0], [z - r.z0, 0, r.z0 - R - z], [r.z1 - z, 0, r.z1 + R - z],
        ];
        opts.sort((a, c) => a[0] - c[0]);
        x += opts[0]![1]; z += opts[0]![2];
      }
    }
    const RP = R + CHAR_RADIUS;
    for (const o of w.people ?? []) {
      const dx = x - o.x, dz = z - o.z, d2 = dx * dx + dz * dz;
      if (d2 >= RP * RP) continue;
      moved = true;
      const d = Math.sqrt(d2) || 1e-6;
      const k = (RP - d) / d;
      x += (d2 > 1e-12 ? dx : 1e-6) * k; z += dz * k;
    }
    const nx = clamp(x, b.x0 + R, b.x1 - R), nz = clamp(z, b.z0 + R, b.z1 - R);
    if (nx !== x || nz !== z) { x = nx; z = nz; }
    if (!moved) break;
  }
  return { x, z };
}

/** Avanza `dt` segundos. Puro: devuelve un estado nuevo. */
export function stepPlayer(s: PlayerState, input: WalkInput, dt: number, w: WalkWorld): PlayerState {
  const yaw = wrap(s.yaw + input.lookYaw);
  const pitch = clamp(s.pitch + input.lookPitch, -PITCH_LIMIT, PITCH_LIMIT);
  let f = clamp(input.forward, -1, 1), st = clamp(input.strafe, -1, 1);
  const len = Math.hypot(f, st);
  if (len > 1) { f /= len; st /= len; }
  let x = s.x, z = s.z;
  const speed = input.run ? RUN_SPEED_P : WALK_SPEED_P;
  // frente = (sin yaw, cos yaw); derecha = (-cos yaw, sin yaw)
  const vx = (Math.sin(yaw) * f - Math.cos(yaw) * st) * speed;
  const vz = (Math.cos(yaw) * f + Math.sin(yaw) * st) * speed;
  const dist = Math.hypot(vx, vz) * Math.max(0, dt);
  if (dist > 0) {
    const n = Math.max(1, Math.ceil(dist / MAX_SUBSTEP));
    const sx = (vx * dt) / n, sz = (vz * dt) / n;
    for (let i = 0; i < n; i++) {
      const q = pushOut(x + sx, z + sz, w);
      // si ya estaba pisando algo (alguien se sentó donde estaba parado) acepta el empujón para poder salir
      if (playerFree(q, w) || !playerFree({ x, z }, w)) { x = q.x; z = q.z; }
    }
  }
  return { x, z, yaw, pitch };
}

/** Dónde aparece: adentro, frente a la puerta (lo más cerca posible del pasillo), mirando hacia el fondo. */
export function spawnAtDoor(w: WalkWorld): PlayerState {
  const z0 = Math.min(ROOM.aisleZ, DOOR.halfWidth - 0.3);
  for (let r = 0; r < 3; r += 0.05) {
    for (const [dx, dz] of [[0, 0], [r, 0], [0, -r], [r, -r], [0, r], [r, r]] as const) {
      const p = { x: DOOR.inX + 0.4 + dx, z: z0 + dz };
      if (playerFree(p, w)) return { ...p, yaw: Math.PI / 2, pitch: 0 };
    }
  }
  return { x: DOOR.inX + 0.4, z: z0, yaw: Math.PI / 2, pitch: 0 };
}

/** Un personaje para apuntar: centro en planta y altura (cilindro vertical de 0 a `h`). */
export interface TargetCandidate { id: string; x: number; z: number; h: number }

/**
 * A quién apunta la mira: el rayo de la vista contra un cilindro por personaje (radio 0,35 m, de 0 a su altura + un margen
 * arriba de la cabeza). Devuelve el más cercano que el rayo toque antes de `range` metros, o null.
 */
export function pickTarget<T extends TargetCandidate>(eye: PlayerState, chars: readonly T[], range = TARGET_RANGE): T | null {
  const cp = Math.cos(eye.pitch), sp = Math.sin(eye.pitch);
  const dx = Math.sin(eye.yaw) * cp, dz = Math.cos(eye.yaw) * cp;   // componente en planta del rayo unitario
  const a = dx * dx + dz * dz;
  if (a < 1e-9) return null;
  let best: T | null = null, bestT = Infinity;
  for (const c of chars) {
    const ox = eye.x - c.x, oz = eye.z - c.z;
    const b = 2 * (ox * dx + oz * dz), cc = ox * ox + oz * oz - TARGET_RADIUS * TARGET_RADIUS;
    const disc = b * b - 4 * a * cc;
    if (disc < 0) continue;
    const t = (-b - Math.sqrt(disc)) / (2 * a);       // entrada al cilindro
    if (t <= 0 || t > range || t >= bestT) continue;
    const y = EYE_HEIGHT + sp * t;
    if (y < 0 || y > c.h + TARGET_HEAD_SLACK) continue;
    best = c; bestT = t;
  }
  return best;
}
