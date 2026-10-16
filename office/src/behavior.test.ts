import { describe, expect, it } from 'vitest';
import type { SessionStatus } from '../../core/state';
import { officeLayout, type Seat } from './layout';
import { queueSpot } from './assign';
import {
  nextBehavior, showsBubble, setAgentSeat, createAgent, stepAgent, poseOf, seatToDoorPath, standUpPoint, findPath, isFree,
  rectsOf, CHAR_RADIUS, type BehaviorState, type Agent, type P,
} from './behavior';

const L = officeLayout();
const allSeats: Seat[] = [...L.seats, ...L.extraSeats, ...Array.from({ length: 40 }, (_, i) => queueSpot(i))];
const run = (a: Agent, status: SessionStatus, secs: number, dt = 1 / 30) => {
  for (let t = 0; t < secs && !a.removed; t += dt) stepAgent(a, status, dt);
  return a;
};

describe('nextBehavior', () => {
  const states: BehaviorState[] = ['seated', 'beckoning', 'walking'];

  it('working_means_seated', () => {
    for (const s of states) expect(nextBehavior('working', s, 0.1)).toBe('seated');
  });

  it('waiting_means_beckoning_with_bubble', () => {
    for (const s of states) expect(nextBehavior('waiting', s, 0.1)).toBe('beckoning');
    expect(showsBubble('beckoning')).toBe(true);
    for (const s of ['seated', 'walking', 'leaving'] as const) expect(showsBubble(s)).toBe(false);
    // y en la escena: el agente vuelve a su puesto y ahí pide atención (pose con señas)
    const a = createAgent(L.seats[5]!, { start: 'lane', seed: 3 });
    run(a, 'waiting', 30);
    expect(a.behavior).toBe('beckoning');
    expect(poseOf(a)).toBe('sit-wave');
  });

  it('idle_means_walking', () => {
    for (const s of states) expect(nextBehavior('idle', s, 0.1)).toBe('walking');
    const a = createAgent(L.seats[0]!, { start: 'seat', seed: 1 });
    expect(poseOf(a)).toBe('sit-type');
    run(a, 'idle', 3);
    expect(a.behavior).toBe('walking');
    expect(a.loc.kind).not.toBe('seat');
    // pasea por el pasillo: cada vez que se queda parado un rato, está dentro de la franja del pasillo
    const stops: P[] = [];
    for (let t = 0; t < 90; t += 1 / 30) {
      stepAgent(a, 'idle', 1 / 30);
      if (!a.target && a.pause > 0) stops.push({ ...a.pos });
    }
    expect(stops.length).toBeGreaterThan(0);
    for (const p of stops) expect(Math.abs(p.z - L.room.aisleZ)).toBeLessThan(L.room.aisleHalf);
  });

  it('closed_means_leaving_then_removed', () => {
    for (const s of states) expect(nextBehavior('closed', s, 0.1)).toBe('leaving');
    // irse es definitivo: si después llega otro estado, no vuelve
    expect(nextBehavior('working', 'leaving', 0.1)).toBe('leaving');
    for (const seat of allSeats) {
      const a = createAgent(seat, { start: 'seat', seed: seat.id });
      stepAgent(a, 'closed', 0.1);
      expect(a.behavior).toBe('leaving');
      expect(a.removed).toBe(false);
      run(a, 'closed', 120);
      expect(a.removed, `puesto ${seat.id} no salió`).toBe(true);
      expect(a.pos.x).toBeLessThan(0); // salió por la puerta
    }
  });
});

describe('caminatas', () => {
  const RECTS = rectsOf(L.props);
  /** Muestrea una polilínea cada 5 cm y devuelve el primer mueble que pisa (inflado por el radio del personaje). */
  function hit(path: P[], skip: (r: (typeof RECTS)[number]) => boolean = () => false) {
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i]!, b = path[i + 1]!;
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05));
      for (let k = 0; k <= n; k++) {
        const x = a.x + (b.x - a.x) * k / n, z = a.z + (b.z - a.z) * k / n;
        for (const r of RECTS) {
          if (skip(r)) continue;
          if (x > r.x0 - CHAR_RADIUS && x < r.x1 + CHAR_RADIUS && z > r.z0 - CHAR_RADIUS && z < r.z1 + CHAR_RADIUS) return `${r.kind} en (${x.toFixed(2)}, ${z.toFixed(2)})`;
        }
      }
    }
    return null;
  }
  const contains = (p: P) => (r: (typeof RECTS)[number]) => p.x >= r.x0 && p.x <= r.x1 && p.z >= r.z0 && p.z <= r.z1;

  it('stand_up_points_are_free', () => {
    for (const seat of [...L.extraSeats, ...allSeats.filter(s => s.island === -2)]) {
      expect(isFree(standUpPoint(seat)), `lugar ${seat.id}`).toBe(true);
    }
  });

  it('routes_from_every_seat_to_the_door_avoid_furniture', () => {
    for (const seat of allSeats) {
      const path = seatToDoorPath(seat);
      expect(path[path.length - 1]!.x).toBeLessThan(0);
      // en el escritorio se ignora solo la silla propia; en bancos y cola se chequea desde el punto de levantarse
      const fromStand = seat.island >= 0 ? path : path.slice(1);
      expect(hit(fromStand, seat.island >= 0 ? contains({ x: seat.position.x, z: seat.position.z }) : undefined), `puesto ${seat.id}`).toBeNull();
    }
  });

  it('paths_between_any_two_seats_avoid_furniture', () => {
    const sample = [...L.seats, ...L.extraSeats];
    for (const a of sample) for (const b of sample) {
      if (a === b) continue;
      const p = findPath(standUpPoint(a), standUpPoint(b));
      const own = (r: (typeof RECTS)[number]) => (a.island >= 0 && contains(a.position)(r)) || (b.island >= 0 && contains(b.position)(r));
      expect(hit(p, own), `${a.id} → ${b.id}`).toBeNull();
    }
  });

  it('agent_follows_routes_back_to_its_seat', () => {
    const seat = L.seats[12]!; // lado de la pared
    const a = createAgent(seat, { start: 'door', seed: 7 });
    run(a, 'working', 60);
    expect(a.loc.kind).toBe('seat');
    expect(a.pos.x).toBeCloseTo(seat.position.x);
    expect(a.pos.z).toBeCloseTo(seat.position.z);
    expect(poseOf(a)).toBe('sit-type');
  });

  it('walkers_entering_together_keep_distance', () => {
    // 6 entran a la vez por la misma puerta hacia puestos del mismo lado: van en fila, sin superponerse
    const seats = L.seats.filter(s => s.position.z > 0).slice(0, 6);
    const ags = seats.map((s, i) => createAgent(s, { start: 'door', seed: i + 1 }));
    let minD = Infinity;
    for (let t = 0; t < 40; t += 1 / 30) {
      ags.forEach((a, i) => stepAgent(a, 'working', 1 / 30, ags, i));
      for (let i = 0; i < ags.length; i++) for (let j = i + 1; j < ags.length; j++) {
        const a = ags[i]!, b = ags[j]!;
        // sentados no cuentan; afuera de la puerta (x < 0) todavía no se ven: ahí esperan su turno para entrar
        if (a.loc.kind === 'seat' || b.loc.kind === 'seat' || a.pos.x < 0 || b.pos.x < 0) continue;
        minD = Math.min(minD, Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z));
      }
    }
    expect(ags.every(a => a.loc.kind === 'seat' && !a.target)).toBe(true); // nadie queda trabado
    expect(minD).toBeGreaterThan(0.4);
  });

  it('agent_moves_to_a_new_seat_when_promoted', () => {
    const a = createAgent(queueSpot(0), { start: 'seat', seed: 2 });
    expect(poseOf(a)).toBe('stand-type');
    setAgentSeat(a, L.seats[2]!);
    run(a, 'working', 60);
    expect(a.loc.kind).toBe('seat');
    expect(a.pos.z).toBeCloseTo(L.seats[2]!.position.z);
    // y cruzar el pasillo también: de un puesto de un lado a uno del otro
    setAgentSeat(a, L.seats[10]!);
    run(a, 'working', 60);
    expect(a.pos.z).toBeCloseTo(L.seats[10]!.position.z);
  });
});

describe('colores y demo', () => {
  it('account_colors_differ_for_A_and_B', async () => {
    const { accountColor } = await import('./character');
    expect(accountColor('Cuenta A')).not.toBe(accountColor('Cuenta B'));
    expect(accountColor('Cuenta A')).toBe(0x3f7fd6); // azul
    expect(accountColor('Cuenta B')).toBe(0xe0604f); // coral
    expect(accountColor('Cuenta A')).toBe(accountColor('Cuenta A'));
  });

  it('demo_feed_changes_states_over_time', async () => {
    const { createDemoFeed } = await import('./demo');
    let ms = 0;
    const feed = createDemoFeed(() => ms);
    const seen = new Set<string>();
    const ids = new Set<string>();
    let max = 0;
    for (ms = 0; ms < 15 * 60_000; ms += 1000) {
      const s = feed.tick();
      max = Math.max(max, s.length);
      for (const x of s) { seen.add(x.status); ids.add(x.id); expect(['Cuenta A', 'Cuenta B']).toContain(x.account); }
    }
    expect(seen).toEqual(new Set(['working', 'waiting', 'idle', 'closed']));
    expect(max).toBeLessThanOrEqual(12);
    expect(ids.size).toBeGreaterThan(12); // se cierran y entran sesiones nuevas
  });
});
