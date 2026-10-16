// Reparto de lugares: puro (sin three), testeable.
//
// Reglas (en este orden):
// 1. Las sesiones `closed` no tienen lugar: el suyo queda libre en el mismo tick (su personaje igual se va caminando; los
//    nuevos entran por la puerta, así que no se pisan).
// 2. Estable: una sesión que ya tenía un puesto o un lugar extra lo conserva (se compara por `id`, no por objeto, porque
//    `prev` puede venir de otro `buildOffice()`).
// 3. Los que esperaban en la cola pasan primero (por orden de llegada a la cola) a los puestos que se liberan; después las
//    sesiones nuevas (por `updatedAt` y luego `id`, para que sea determinista). Siempre: primero los 16 puestos (los del lado del
//    pasillo antes que los de la pared, ver `preferenceOrder`), después los
//    lugares extra (bancos del pasillo) y recién después la cola.
// 4. La cola: lugares de pie que no pisan muebles, ni la franja central del pasillo, ni a nadie (ver `queueSpot`). Quien
//    está en la cola conserva su lugar de la cola hasta que lo ascienden; no se reacomoda para no hacer ruido.
import type { SessionSnapshot } from '../../core/identity';
import { officeLayout, ROOM, type Seat } from './layout';
import { CHAR_RADIUS, isFree } from './behavior';

/** Los lugares de la cola tienen id >= QUEUE_ID_BASE e `island: -2`. */
export const QUEUE_ID_BASE = 1000;

const SPACING = 0.6;
const MIN_GAP = 0.45;            // distancia mínima a cualquier otro lugar (puesto, banco u otro de la cola)

/**
 * Lugares de pie de la cola, calculados UNA vez desde el plano (`officeLayout`), así siguen valiendo si cambia el salón:
 * una grilla de 0,6 m de la que se quedan los puntos donde un personaje parado no pisa muebles ni paredes, no está en la
 * franja del pasillo (|z - aisleZ| < aisleHalf + radio) ni en la entrada, y queda a >= 0,45 m de cualquier otro lugar.
 * Orden: primero la franja libre detrás de las islas de la izquierda (lejos de donde se camina), de la entrada al fondo;
 * después el resto, también de la entrada al fondo. Miran hacia el pasillo.
 */
const INSIDE: Array<{ x: number; z: number }> = (() => {
  const L = officeLayout();
  const taken = [...L.seats, ...L.extraSeats].map(s => ({ x: s.position.x, z: s.position.z }));
  const leftDesk = Math.min(...L.props.filter(p => p.kind === 'chair').map(p => p.z - p.d / 2));
  const cands: Array<{ x: number; z: number; strip: number }> = [];
  for (let x = 0.9; x < ROOM.length - 0.5; x += SPACING) {
    for (let z = -ROOM.width / 2 + 0.6; z < ROOM.width / 2 - 0.5; z += SPACING) {
      const p = { x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 };
      if (Math.abs(p.z - ROOM.aisleZ) < ROOM.aisleHalf + CHAR_RADIUS + 0.1) continue;   // el pasillo queda para caminar
      if (p.x < 1.6 && Math.abs(p.z) < 1.3) continue;                                    // ni delante de la puerta
      if (!isFree(p) || !isFree({ x: p.x, z: p.z }, [])) continue;
      // detrás de las sillas de la pared izquierda dejar 0,6 m para pasar
      const strip = p.z < leftDesk - 0.6 - CHAR_RADIUS ? 0 : 1;
      if (p.z < leftDesk && strip === 1) continue;
      cands.push({ ...p, strip });
    }
  }
  cands.sort((a, b) => a.strip - b.strip || a.x - b.x || a.z - b.z);
  const out: Array<{ x: number; z: number }> = [];
  for (const c of cands) {
    if ([...taken, ...out].some(t => Math.hypot(t.x - c.x, t.z - c.z) < MIN_GAP)) continue;
    // que no quede pegado a un mueble (holgura extra de 5 cm)
    if (!isFree({ x: c.x + 0.05, z: c.z }) || !isFree({ x: c.x - 0.05, z: c.z }) || !isFree({ x: c.x, z: c.z + 0.05 }) || !isFree({ x: c.x, z: c.z - 0.05 })) continue;
    out.push({ x: c.x, z: c.z });
  }
  return out;
})();

/** Cuántos lugares de pie hay adentro del salón (el resto de la cola espera afuera). */
export const QUEUE_INSIDE = INSIDE.length;

/**
 * Lugar `i` de la cola (determinista). Primero los `QUEUE_INSIDE` lugares de pie del salón; de ahí en más (no debería
 * pasar nunca) se forman en filas de 3 afuera de la puerta (x < 0), sin pisarse: no se ven desde adentro pero no se
 * pierden y entran cuando se libera algo.
 */
export function queueSpot(i: number): Seat {
  const id = QUEUE_ID_BASE + i;
  const p = INSIDE[i];
  if (p) return { id, position: { x: p.x, y: 0, z: p.z }, facing: p.z < ROOM.aisleZ ? 0 : Math.PI, island: -2 };
  const k = i - INSIDE.length;
  return { id, position: { x: -1.2 - SPACING * Math.floor(k / 3), y: 0, z: SPACING * ((k % 3) - 1) }, facing: Math.PI / 2, island: -2 };
}

/**
 * Orden en que se ocupan los puestos libres: primero los del lado del pasillo (se ven desde cualquier cámara), de la
 * entrada al fondo y alternando paredes; después los del lado de la pared. Así con pocas sesiones nadie queda escondido.
 */
function preferenceOrder(seats: Seat[]): Seat[] {
  const toAisle = (s: Seat) => Math.abs(s.position.z - ROOM.aisleZ);
  const inner = new Map<number, number>();
  for (const s of seats) inner.set(s.island, Math.min(inner.get(s.island) ?? Infinity, toAisle(s)));
  const wallSide = (s: Seat) => (toAisle(s) > (inner.get(s.island) ?? 0) + 1e-6 ? 1 : 0);
  return [...seats].sort((a, b) => wallSide(a) - wallSide(b) || a.position.x - b.position.x || a.position.z - b.position.z || a.id - b.id);
}

export function assignSeats(
  snaps: SessionSnapshot[], seats: Seat[], extra: Seat[], prev: Map<string, Seat>,
): Map<string, Seat> {
  const out = new Map<string, Seat>();
  const byId = new Map<number, Seat>();
  for (const s of [...seats, ...extra]) byId.set(s.id, s);
  const taken = new Set<number>();

  // sesiones vivas, sin repetidos (si un id viene dos veces, vale la primera)
  const live: SessionSnapshot[] = [];
  const seen = new Set<string>();
  for (const s of snaps) if (s.status !== 'closed' && !seen.has(s.id)) { seen.add(s.id); live.push(s); }

  // 2. estables
  const queued: Array<{ snap: SessionSnapshot; q: number }> = [];
  const fresh: SessionSnapshot[] = [];
  for (const s of live) {
    const p = prev.get(s.id);
    const cur = p ? byId.get(p.id) : undefined;
    if (cur && !taken.has(cur.id)) { out.set(s.id, cur); taken.add(cur.id); }
    else if (p && p.id >= QUEUE_ID_BASE) queued.push({ snap: s, q: p.id - QUEUE_ID_BASE });
    else fresh.push(s);
  }

  // 3. ascensos de la cola y después los nuevos
  queued.sort((a, b) => a.q - b.q);
  fresh.sort((a, b) => a.updatedAt - b.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const order = preferenceOrder(seats);
  const freeSeat = () => order.find(s => !taken.has(s.id)) ?? extra.find(s => !taken.has(s.id));
  const takenQ = new Set<number>();
  const needQueue: SessionSnapshot[] = [];
  for (const { snap, q } of queued) {
    const f = freeSeat();
    if (f) { out.set(snap.id, f); taken.add(f.id); }
    else { out.set(snap.id, queueSpot(q)); takenQ.add(q); }
  }
  for (const snap of fresh) {
    const f = freeSeat();
    if (f) { out.set(snap.id, f); taken.add(f.id); }
    else needQueue.push(snap);
  }
  // 4. cola: el lugar libre más chico
  let q = 0;
  for (const snap of needQueue) {
    while (takenQ.has(q)) q++;
    out.set(snap.id, queueSpot(q));
    takenQ.add(q);
  }
  return out;
}
