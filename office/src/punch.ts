// Golpe en el modo recorrido: lógica pura (sin three). Es SOLO visual y local: no toca agentes, sesiones ni lo que va al relay.
// - `tryPunch`/`stepPunch`: animación (PUNCH_TIME) y espera entre golpes (PUNCH_COOLDOWN).
// - `pickPunchTarget`: el personaje a menos de PUNCH_RANGE y dentro de PUNCH_CONE del centro de la vista (el más centrado).
// - `startReaction`/`stepReaction`/`reactionPose`: el golpeado se tambalea hacia atrás (de pie) o pega un respingo (sentado)
//   y vuelve en REACT_TIME. El retroceso se recorta contra muebles y paredes (círculo de radio CHAR_RADIUS).
import { CHAR_RADIUS, type P } from './behavior';
import type { PlayerState, WalkWorld } from './walk';

export const PUNCH_RANGE = 1.3;
export const PUNCH_CONE = (35 * Math.PI) / 180;
export const PUNCH_TIME = 0.3;
export const PUNCH_COOLDOWN = 0.45;
export const REACT_TIME = 1.0;
export const KNOCKBACK = 0.35;

export interface PunchState { /** segundos desde el último golpe (Infinity = nunca) */ since: number }
export const PUNCH_IDLE: PunchState = { since: Infinity };

export function tryPunch(s: PunchState): { state: PunchState; fired: boolean } {
  if (s.since < PUNCH_COOLDOWN) return { state: s, fired: false };
  return { state: { since: 0 }, fired: true };
}
export const stepPunch = (s: PunchState, dt: number): PunchState => ({ since: s.since + dt });
/** 0 = puño en reposo, 1 = brazo estirado. */
export function punchExtension(s: PunchState): number {
  if (!(s.since < PUNCH_TIME)) return 0;
  return Math.sin((s.since / PUNCH_TIME) * Math.PI);
}

export function pickPunchTarget<T extends { id: string; x: number; z: number }>(eye: PlayerState, chars: readonly T[]): T | null {
  const fx = Math.sin(eye.yaw), fz = Math.cos(eye.yaw);
  let best: T | null = null, bestAng = Infinity;
  for (const c of chars) {
    const dx = c.x - eye.x, dz = c.z - eye.z, d = Math.hypot(dx, dz);
    if (d > PUNCH_RANGE || d < 1e-6) continue;
    const ang = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d)));
    if (ang > PUNCH_CONE || ang >= bestAng) continue;
    best = c; bestAng = ang;
  }
  return best;
}

export interface Reaction { id: string; kind: 'stagger' | 'flinch'; t: number; dirX: number; dirZ: number }

/** Reacción al golpe: dirección = del jugador hacia el golpeado. Sentado → respingo en el lugar (no sale de la silla). */
export function startReaction(id: string, seated: boolean, from: P, at: P): Reaction {
  let dx = at.x - from.x, dz = at.z - from.z;
  const d = Math.hypot(dx, dz) || 1;
  dx /= d; dz /= d;
  return { id, kind: seated ? 'flinch' : 'stagger', t: 0, dirX: dx, dirZ: dz };
}

/** Avanza la reacción hasta el tiempo `t` desde el golpe… o `dt` más; null cuando terminó. */
export function stepReaction(r: Reaction, dt: number): Reaction | null {
  const t = r.t + dt;
  return t > REACT_TIME ? null : { ...r, t };
}

/** Curva: retrocede rápido (0,18 s), se queda, y vuelve suave hasta REACT_TIME. */
function envelope(t: number): number {
  if (t < 0.18) return Math.sin((t / 0.18) * (Math.PI / 2));
  if (t < 0.45) return 1;
  const k = Math.min(1, (t - 0.45) / (REACT_TIME - 0.45));
  return 1 - k * k * (3 - 2 * k);
}

function circleFree(x: number, z: number, w: WalkWorld, ignore: ReadonlySet<number>): boolean {
  const R = CHAR_RADIUS - 1e-7, b = w.bounds;
  if (x < b.x0 + R || x > b.x1 - R || z < b.z0 + R || z > b.z1 - R) return false;
  for (let i = 0; i < w.rects.length; i++) {
    if (ignore.has(i)) continue;
    const r = w.rects[i]!;
    const dx = x - Math.max(r.x0, Math.min(r.x1, x)), dz = z - Math.max(r.z0, Math.min(r.z1, z));
    if (dx * dx + dz * dz < R * R) return false;
  }
  return true;
}

/**
 * Desplazamiento visual (dx, dz) desde la posición real `pos`, más salto (`lift`, m) y bamboleo (`wobble`, rad). El retroceso
 * se corta donde chocaría con un mueble o pared (se ignora lo que ya pisaba al empezar, p. ej. la silla propia).
 */
export function reactionPose(r: Reaction, pos: P, w: WalkWorld): { dx: number; dz: number; lift: number; wobble: number } {
  const e = envelope(r.t);
  const fade = 1 - r.t / REACT_TIME;
  if (r.kind === 'flinch') {
    const hop = r.t < 0.25 ? Math.sin((r.t / 0.25) * Math.PI) * 0.07 : 0;
    return { dx: 0, dz: 0, lift: hop, wobble: Math.sin(r.t * 30) * 0.12 * fade };
  }
  const ignore = new Set<number>();
  const R = CHAR_RADIUS;
  w.rects.forEach((q, i) => {
    const dx = pos.x - Math.max(q.x0, Math.min(q.x1, pos.x)), dz = pos.z - Math.max(q.z0, Math.min(q.z1, pos.z));
    if (dx * dx + dz * dz < R * R) ignore.add(i);
  });
  const want = KNOCKBACK * e;
  let d = 0;
  for (let s = 0.02; s <= want + 1e-9; s += 0.02) {
    if (!circleFree(pos.x + r.dirX * s, pos.z + r.dirZ * s, w, ignore)) break;
    d = s;
  }
  if (d < want && circleFree(pos.x + r.dirX * want, pos.z + r.dirZ * want, w, ignore) && d >= want - 0.02) d = want;
  return { dx: r.dirX * d, dz: r.dirZ * d, lift: 0, wobble: Math.sin(r.t * 22) * 0.22 * fade };
}
