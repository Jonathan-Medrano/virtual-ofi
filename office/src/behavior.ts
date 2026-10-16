// Comportamiento de los personajes: puro (sin three), testeable.
//
// Dos capas:
// - `nextBehavior`: qué QUIERE hacer el personaje según el estado de su sesión (working→sentado, waiting→señas,
//   idle→camina, closed→se va; irse es definitivo).
// - `Agent` + `stepAgent`: DÓNDE está y cómo se mueve. Las caminatas se planifican con A* sobre una grilla de 10 cm armada
//   UNA vez con los muebles de `officeLayout().props` (inflados por el radio del personaje) y las paredes; después se
//   "tira del hilo" (string pulling) con chequeo continuo contra los mismos rectángulos que usa el test. Así no se cruzan
//   muebles aunque cambie el plano. Solo se planifica al decidir (llegar a un punto, cambiar de estado), nunca por frame.
import type { SessionStatus } from '../../core/state';
import { officeLayout, ROOM, DOOR, type Prop, type Seat } from './layout';

export type BehaviorState = 'seated' | 'beckoning' | 'walking' | 'leaving';

/** Radio del personaje en planta (hombros), para no pisar muebles ni a otros. */
export const CHAR_RADIUS = 0.2;
export const WALK_SPEED = 1.1;          // m/s
/** Distancia mínima entre dos que caminan en fila. */
export const FOLLOW_GAP = 0.55;
const DOOR_Z = DOOR.laneZ;                // por dónde atraviesan la puerta (que va de z = -1 a 1)
const DOOR_IN_X = DOOR.inX;              // umbral de adentro
export const DOOR_OUT_X = DOOR.outX;     // afuera: ahí desaparecen / de ahí entran
const CELL = 0.1;
const GRID_PAD = 0.02;                   // la grilla infla un poco más que el chequeo continuo (pasos angostos de 0,5 m siguen pasando)
const LOS_PAD = 0.01;

export interface P { x: number; z: number }
export interface Rect { kind: Prop['kind']; x0: number; x1: number; z0: number; z1: number }

/**
 * Qué hace el personaje según el estado de la sesión. `dt` queda en la firma del contrato pero hoy no se usa: la
 * transición es inmediata; lo que tarda (caminar hasta el puesto, salir) lo resuelve `stepAgent`.
 */
export function nextBehavior(status: SessionStatus, current: BehaviorState, _dt: number): BehaviorState {
  if (current === 'leaving' || status === 'closed') return 'leaving';
  if (status === 'waiting') return 'beckoning';
  if (status === 'idle') return 'walking';
  return 'seated';
}

/** El globito "!" sobre la cabeza: solo cuando la sesión espera al usuario. */
export function showsBubble(b: BehaviorState): boolean {
  return b === 'beckoning';
}

/** Rectángulos en planta de los muebles (w a lo largo de x, d a lo largo de z: ya vienen girados en el layout). */
export function rectsOf(props: Prop[]): Rect[] {
  return props.map(p => ({ kind: p.kind, x0: p.x - p.w / 2, x1: p.x + p.w / 2, z0: p.z - p.d / 2, z1: p.z + p.d / 2 }));
}

// ---------- mapa de obstáculos ----------

const RECTS = rectsOf(officeLayout().props);
const HW = ROOM.width / 2;
const NX = Math.round(ROOM.length / CELL), NZ = Math.round(ROOM.width / CELL);
const inRect = (x: number, z: number, r: Rect, pad: number) => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad;
const inWalls = (x: number, z: number, pad: number) => x < pad || x > ROOM.length - pad || z < -HW + pad || z > HW - pad;

let grid: Uint8Array | null = null;
function blockedGrid(): Uint8Array {
  if (grid) return grid;
  grid = new Uint8Array(NX * NZ);
  const pad = CHAR_RADIUS + GRID_PAD;
  for (let i = 0; i < NX; i++) for (let k = 0; k < NZ; k++) {
    const x = (i + 0.5) * CELL, z = -HW + (k + 0.5) * CELL;
    if (inWalls(x, z, pad) || RECTS.some(r => inRect(x, z, r, pad))) grid[i * NZ + k] = 1;
  }
  return grid;
}
const cellOf = (p: P): [number, number] => [
  Math.min(NX - 1, Math.max(0, Math.floor(p.x / CELL))), Math.min(NZ - 1, Math.max(0, Math.floor((p.z + HW) / CELL))),
];
const centerOf = (i: number, k: number): P => ({ x: (i + 0.5) * CELL, z: -HW + (k + 0.5) * CELL });

/** ¿Un personaje parado en `p` no pisa ningún mueble (salvo los de `ignore`) ni la pared? */
export function isFree(p: P, ignore: readonly Rect[] = []): boolean {
  const pad = CHAR_RADIUS + LOS_PAD;
  if (inWalls(p.x, p.z, CHAR_RADIUS)) return false;
  return !RECTS.some(r => !ignore.includes(r) && inRect(p.x, p.z, r, pad));
}

function lineFree(a: P, b: P, ignore: readonly Rect[]): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.04));
  for (let s = 0; s <= n; s++) {
    const t = s / n;
    if (!isFree({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, ignore)) return false;
  }
  return true;
}

/**
 * Camino libre de `from` a `to` (incluye ambos). Los muebles que ya contienen a `from` o a `to` (la silla propia) se
 * ignoran, para poder salir y llegar. Si no hay camino devuelve la recta (no debería pasar: lo cubre un test).
 */
export function findPath(from: P, to: P): P[] {
  const pad = CHAR_RADIUS + LOS_PAD;
  const ignore = RECTS.filter(r => inRect(from.x, from.z, r, pad) || inRect(to.x, to.z, r, pad));
  if (lineFree(from, to, ignore)) return [from, to];
  const g = blockedGrid();
  const gpad = CHAR_RADIUS + GRID_PAD;
  const ignG = RECTS.filter(r => inRect(from.x, from.z, r, gpad) || inRect(to.x, to.z, r, gpad));
  const free = (i: number, k: number) => {
    if (!g[i * NZ + k]) return true;
    if (!ignG.length) return false;
    const c = centerOf(i, k);
    if (inWalls(c.x, c.z, gpad)) return false;
    // bloqueada solo por muebles ignorados → libre
    return !RECTS.some(r => !ignG.includes(r) && inRect(c.x, c.z, r, gpad));
  };
  const [si, sk] = cellOf(from), [gi, gk] = cellOf(to);
  const N = NX * NZ, start = si * NZ + sk, goal = gi * NZ + gk;
  const gs = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const heap: Array<[number, number]> = [];
  const push = (f: number, c: number) => {
    heap.push([f, c]);
    let j = heap.length - 1;
    while (j > 0) { const p = (j - 1) >> 1; if (heap[p]![0] <= heap[j]![0]) break; [heap[p], heap[j]] = [heap[j]!, heap[p]!]; j = p; }
  };
  const pop = () => {
    const top = heap[0]!, last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let j = 0;
      for (;;) {
        const l = 2 * j + 1, r = l + 1;
        let m = j;
        if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
        if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
        if (m === j) break;
        [heap[m], heap[j]] = [heap[j]!, heap[m]!]; j = m;
      }
    }
    return top;
  };
  const h = (i: number, k: number) => { const dx = Math.abs(i - gi), dk = Math.abs(k - gk); return Math.max(dx, dk) + 0.4142 * Math.min(dx, dk); };
  gs[start] = 0; push(h(si, sk), start);
  let found = false;
  while (heap.length) {
    const [, c] = pop();
    if (closed[c]) continue;
    if (c === goal) { found = true; break; }
    closed[c] = 1;
    const i = Math.floor(c / NZ), k = c % NZ;
    for (let di = -1; di <= 1; di++) for (let dk = -1; dk <= 1; dk++) {
      if (!di && !dk) continue;
      const ni = i + di, nk = k + dk;
      if (ni < 0 || nk < 0 || ni >= NX || nk >= NZ) continue;
      const nc = ni * NZ + nk;
      if (closed[nc] || (nc !== goal && !free(ni, nk))) continue;
      if (di && dk && (!free(i + di, k) || !free(i, k + dk))) continue;   // no cortar esquinas
      const ng = gs[c]! + (di && dk ? 1.4142 : 1);
      if (ng < gs[nc]!) { gs[nc] = ng; came[nc] = c; push(ng + h(ni, nk), nc); }
    }
  }
  if (!found) return [from, to];
  const cells: P[] = [];
  for (let c = goal; c !== start && c >= 0; c = came[c]!) cells.push(centerOf(Math.floor(c / NZ), c % NZ));
  cells.reverse();
  const pts = [from, ...cells.slice(0, -1), to];
  // tirar del hilo: de cada ancla, el punto más lejano que se ve en línea recta
  const out: P[] = [from];
  let anchor = 0;
  while (anchor < pts.length - 1) {
    let j = pts.length - 1;
    while (j > anchor + 1 && !lineFree(pts[anchor]!, pts[j]!, ignore)) j--;
    out.push(pts[j]!);
    anchor = j;
  }
  return out;
}

// ---------- puntos de la oficina ----------

const sideOf = (z: number): 1 | -1 => (z < 0 ? -1 : 1);
export const doorIn = (s: 1 | -1): P => ({ x: DOOR_IN_X, z: s * DOOR_Z });
export const doorOut = (s: 1 | -1): P => ({ x: DOOR_OUT_X, z: s * DOOR_Z });

/**
 * Dónde queda parado al levantarse. En una silla de escritorio, ahí mismo (la silla se ignora al salir). En un banco del
 * pasillo o un lugar de la cola, avanza hacia donde mira hasta quedar libre de todo mueble (así no camina por encima del
 * banco ni del que está sentado al lado).
 */
export function standUpPoint(seat: Seat): P {
  const p = { x: seat.position.x, z: seat.position.z };
  if (seat.island >= 0 || seat.position.x < 0) return p;
  const fx = Math.sin(seat.facing), fz = Math.cos(seat.facing);
  for (let d = 0; d <= 1.2; d += 0.05) {
    const q = { x: p.x + fx * d, z: p.z + fz * d };
    if (isFree(q)) return q;
  }
  return p;
}

/** Salida desde un lugar: [lugar, (punto de levantarse)]. Los lugares de afuera (cola desbordada) entran por la puerta. */
function departFrom(seat: Seat): P[] {
  const p = { x: seat.position.x, z: seat.position.z };
  if (p.x < 0) { const s = sideOf(p.z); return [p, doorOut(s), doorIn(s)]; }
  const su = standUpPoint(seat);
  return Math.hypot(su.x - p.x, su.z - p.z) > 1e-6 ? [p, su] : [p];
}

/** Llegada a un lugar: el camino hasta su punto de levantarse y el último paso hasta el lugar. */
function pathTo(from: P, seat: Seat): P[] {
  const p = { x: seat.position.x, z: seat.position.z };
  if (p.x < 0) { const s = sideOf(p.z); return [...findPath(from, doorIn(s)), doorOut(s), p]; }
  const su = standUpPoint(seat);
  if (Math.hypot(su.x - p.x, su.z - p.z) < 1e-6) return findPath(from, p);
  return [...findPath(from, su), p];
}

/** Recorrido completo de un lugar hasta afuera (el mismo que hace al irse; lo usa el test de muebles). */
export function seatToDoorPath(seat: Seat): P[] {
  const dep = departFrom(seat);
  const last = dep[dep.length - 1]!;
  const s = sideOf(last.z);
  return [...dep.slice(0, -1), ...findPath(last, doorIn(s)), doorOut(s)];
}

// ---------- agente ----------

export type Loc = { kind: 'seat' } | { kind: 'floor' } | { kind: 'outside' };
export type Pose = 'sit-type' | 'sit-wave' | 'stand-type' | 'stand-wave' | 'walk' | 'stand';
type Goal = 'seat' | 'wander' | 'door' | null;

export interface Agent {
  seat: Seat;
  /** Puesto nuevo (ascenso desde la cola, por ejemplo): se aplica en la próxima decisión. */
  pending: Seat | null;
  behavior: BehaviorState;
  pos: P;
  /** Hacia dónde mira: el frente es (sin(heading), cos(heading)), igual que `Seat.facing`. */
  heading: number;
  loc: Loc;
  /** Punto al que camina ahora (null = quieto) y los que siguen. */
  target: P | null;
  path: P[];
  goal: Goal;
  pause: number;
  removed: boolean;
  rng: number;
}

function rand(a: Agent): number {
  // mulberry32: determinista por personaje
  a.rng = (a.rng + 0x6d2b79f5) | 0;
  let t = a.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Dónde pasean: el pasillo desde la primera isla hasta casi el fondo (no frente a la puerta: ahí taparían la cámara). */
const WANDER_X0 = 3.2, WANDER_X1 = ROOM.length - 1.4;
/** Punto libre al azar del pasillo (para pasear). */
function wanderPoint(a: Agent): P {
  const zMax = Math.max(0, ROOM.aisleHalf - CHAR_RADIUS - 0.05);
  for (let k = 0; k < 40; k++) {
    const p = { x: WANDER_X0 + rand(a) * (WANDER_X1 - WANDER_X0), z: ROOM.aisleZ + (rand(a) * 2 - 1) * zMax };
    if (isFree(p)) return p;
  }
  return doorIn(sideOf(a.pos.z));
}

export function createAgent(seat: Seat, opts: { start?: 'seat' | 'door' | 'lane'; seed?: number } = {}): Agent {
  const a: Agent = {
    seat, pending: null, behavior: 'seated', pos: { x: seat.position.x, z: seat.position.z }, heading: seat.facing,
    loc: { kind: 'seat' }, target: null, path: [], goal: null, pause: 0, removed: false,
    rng: ((opts.seed ?? 1) * 2654435761) | 0,
  };
  const start = opts.start ?? 'seat';
  if (start === 'door') {
    a.pos = doorOut(sideOf(seat.position.z));
    a.loc = { kind: 'outside' };
    a.heading = Math.PI / 2;
  } else if (start === 'lane') {
    a.pos = wanderPoint(a);
    a.loc = { kind: 'floor' };
    a.heading = rand(a) < 0.5 ? Math.PI / 2 : -Math.PI / 2;
    a.pause = rand(a) * 2;
  }
  return a;
}

/** Cambia el puesto del personaje; si ya estaba sentado en otro, se levanta y camina al nuevo. */
export function setAgentSeat(a: Agent, seat: Seat): void {
  if (seat.id === a.seat.id) { a.seat = seat; a.pending = null; return; }
  a.pending = seat;
}

const wantOf = (a: Agent): Exclude<Goal, null> => (a.behavior === 'leaving' ? 'door' : a.behavior === 'walking' ? 'wander' : 'seat');

/** Arma el recorrido hacia `goal` desde donde esté y deja el primer tramo en `target`. */
function plan(a: Agent, goal: Exclude<Goal, null>): void {
  let pts: P[];
  let from: P;
  if (a.loc.kind === 'seat') { pts = departFrom(a.seat); from = pts.pop()!; }
  else if (a.loc.kind === 'outside') { pts = [{ ...a.pos }]; from = doorIn(sideOf(a.pos.z)); }
  else { pts = []; from = { ...a.pos }; }
  if (a.pending && goal !== 'door') { a.seat = a.pending; a.pending = null; }
  let rest: P[];
  if (goal === 'seat') rest = pathTo(from, a.seat);
  else if (goal === 'door') { const s = sideOf(from.z); rest = [...findPath(from, doorIn(s)), doorOut(s)]; }
  else rest = findPath(from, wanderPoint(a));
  const all = [...pts, ...rest].filter((p, i, arr) => i === 0 || Math.hypot(p.x - arr[i - 1]!.x, p.z - arr[i - 1]!.z) > 1e-6);
  if (all.length && Math.hypot(all[0]!.x - a.pos.x, all[0]!.z - a.pos.z) < 1e-6) all.shift();   // donde está parado
  a.goal = goal;
  a.loc = { kind: a.pos.x < 0 ? 'outside' : 'floor' };
  a.target = all.shift() ?? null;
  a.path = all;
  if (!a.target) arrive(a);
}

/** Llegó al final del recorrido. */
function arrive(a: Agent): void {
  const g = a.goal;
  a.goal = null;
  if (g === 'seat') { a.loc = { kind: 'seat' }; a.heading = a.seat.facing; }
  else if (g === 'door') a.removed = true;
  else if (g === 'wander') a.pause = 1.5 + rand(a) * 3;
}

function decide(a: Agent, dt: number): void {
  const want = wantOf(a);
  // en medio de un recorrido: si sigue queriendo lo mismo, al próximo punto; si no, replanifica desde acá
  if (a.goal !== null && a.goal === want && !(a.pending && want !== 'door')) {
    const next = a.path.shift();
    if (next) a.target = next; else arrive(a);
    return;
  }
  if (a.goal !== null) { a.goal = null; a.path = []; a.pause = 0; }
  if (want === 'seat') {
    if (a.loc.kind === 'seat' && !a.pending) { a.heading = a.seat.facing; return; }
    plan(a, 'seat'); return;
  }
  if (want === 'door') { plan(a, 'door'); return; }
  if (a.loc.kind !== 'seat' && a.pause > 0) { a.pause -= dt; return; }
  plan(a, 'wander');
}

/**
 * ¿Hay alguien justo adelante yendo para el mismo lado, o paseando y parado un rato? Entonces espera en vez de
 * atravesarlo: evita que los que entran juntos caminen superpuestos. Los sentados (puesto, banco, cola) nunca frenan a
 * nadie. Si van en sentidos opuestos se cruzan (no hay bloqueo mutuo posible). Empate en el mismo punto: espera el de
 * índice mayor.
 */
export function isBlocked(a: Agent, others: readonly Agent[], self = -1): boolean {
  if (!a.target) return false;
  const hx = Math.sin(a.heading), hz = Math.cos(a.heading);
  for (let k = 0; k < others.length; k++) {
    const o = others[k]!;
    if (o === a || o.removed || o.loc.kind === 'seat') continue;
    const dx = o.pos.x - a.pos.x, dz = o.pos.z - a.pos.z;
    const d = Math.hypot(dx, dz);
    if (d >= FOLLOW_GAP) continue;
    if (d < 0.02) { if (k < self) return true; continue; }
    if ((dx * hx + dz * hz) / d < 0.7) continue;                 // no está adelante
    if (o.target) { if (Math.sin(o.heading) * hx + Math.cos(o.heading) * hz > 0.5) return true; }
    else if (o.pause > 0 && o.goal === null) return true;
  }
  return false;
}

/**
 * Avanza `dt` segundos. Muta y devuelve el mismo agente (para no generar basura por frame). Con `others` (todos los
 * agentes de la oficina) y su índice `self`, no camina este frame si tiene a alguien adelante (ver `isBlocked`).
 */
export function stepAgent(a: Agent, status: SessionStatus, dt: number, others?: readonly Agent[], self = -1): Agent {
  if (a.removed) return a;
  a.behavior = nextBehavior(status, a.behavior, dt);
  if (!a.target) decide(a, dt);
  if (a.target) {
    const dx = a.target.x - a.pos.x, dz = a.target.z - a.pos.z;
    const d = Math.hypot(dx, dz), step = WALK_SPEED * dt;
    if (d > 1e-6) a.heading = Math.atan2(dx, dz);
    if (others && isBlocked(a, others, self)) return a;
    if (d <= step) {
      a.pos.x = a.target.x; a.pos.z = a.target.z; a.target = null;
      if (a.loc.kind === 'outside' && a.pos.x >= 0) a.loc = { kind: 'floor' };
      if (!a.path.length && a.goal !== null && a.goal === wantOf(a) && !a.pending) arrive(a);
    } else {
      a.pos.x += (dx / d) * step; a.pos.z += (dz / d) * step;
    }
  }
  return a;
}

/** Pose para dibujar. Los de la cola están de pie (no tienen silla). */
export function poseOf(a: Agent): Pose {
  if (a.target) return 'walk';
  if (a.loc.kind === 'seat') {
    const standing = a.seat.island === -2;
    if (a.behavior === 'beckoning') return standing ? 'stand-wave' : 'sit-wave';
    if (a.behavior === 'seated') return standing ? 'stand-type' : 'sit-type';
  }
  return 'stand';
}
