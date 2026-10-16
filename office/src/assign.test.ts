import { describe, expect, it } from 'vitest';
import type { SessionSnapshot } from '../../core/identity';
import type { SessionStatus } from '../../core/state';
import { officeLayout, type Seat } from './layout';
import { assignSeats, queueSpot, QUEUE_ID_BASE } from './assign';
import { CHAR_RADIUS, rectsOf } from './behavior';

const L = officeLayout();
const snap = (i: number, status: SessionStatus = 'working', updatedAt = 1000 + i): SessionSnapshot =>
  ({ id: `s${i}`, pc: i % 2 ? 'PC-1' : 'PC-2', account: i % 2 ? 'Cuenta A' : 'Cuenta B', project: `proyecto-${i}`, status, updatedAt });
const many = (n: number, status: SessionStatus = 'working') => Array.from({ length: n }, (_, i) => snap(i, status));
const assign = (snaps: SessionSnapshot[], prev = new Map<string, Seat>()) => assignSeats(snaps, L.seats, L.extraSeats, prev);

describe('assignSeats', () => {
  it('seat_is_stable_across_updates', () => {
    const first = assign(many(10));
    // cambian estados, se reordena la lista y entran sesiones nuevas: los que ya estaban no se mueven
    const next = [...many(10, 'idle')].reverse().concat([snap(40), snap(41)]);
    const second = assign(next, first);
    for (const [id, seat] of first) expect(second.get(id)?.id).toBe(seat.id);
    // prev puede traer objetos Seat de otro buildOffice(): se compara por id
    const clone = new Map([...first].map(([k, s]) => [k, { ...s, position: { ...s.position } }]));
    const third = assign(next, clone);
    for (const [id, seat] of first) expect(third.get(id)?.id).toBe(seat.id);
  });

  it('closed_session_frees_seat', () => {
    const first = assign(many(16));
    const seatOf3 = first.get('s3')!.id;
    const snaps = many(16);
    snaps[3] = snap(3, 'closed');
    const second = assign([...snaps, snap(50)], first);
    expect(second.has('s3')).toBe(false);
    expect(second.get('s50')?.id).toBe(seatOf3); // el puesto liberado se reusa (no va a un banco)
  });

  it('17th_goes_to_extra', () => {
    const m = assign(many(17));
    const desk = [...m.values()].filter(s => s.island >= 0);
    expect(desk).toHaveLength(16);
    const extraIds = new Set(L.extraSeats.map(s => s.id));
    expect(extraIds.has(m.get('s16')!.id)).toBe(true);
  });

  it('more_than_all_seats_gets_queue_not_overlap', () => {
    const total = L.seats.length + L.extraSeats.length; // 24
    for (const n of [total + 1, total + 10, 120]) {
      const m = assign(many(n));
      expect(m.size).toBe(n);                        // nadie se pierde
      const placed = [...m.values()];
      expect(new Set(placed.map(s => s.id)).size).toBe(n); // ningún lugar repetido
      const queued = placed.filter(s => s.id >= QUEUE_ID_BASE);
      expect(queued).toHaveLength(n - total);
      // distancia mínima entre cualquier par de lugares: nadie encima de nadie
      for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]!.position, b = placed[j]!.position;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(2 * CHAR_RADIUS);
      }
      // los lugares de la cola no pisan muebles
      for (const q of queued) for (const r of rectsOf(L.props)) {
        const inside = q.position.x > r.x0 - CHAR_RADIUS && q.position.x < r.x1 + CHAR_RADIUS
          && q.position.z > r.z0 - CHAR_RADIUS && q.position.z < r.z1 + CHAR_RADIUS;
        expect(inside, `cola ${q.id} pisa ${r.kind}`).toBe(false);
      }
    }
  });

  it('queue_is_promoted_when_a_seat_frees_and_otherwise_stable', () => {
    const first = assign(many(26));
    const q24 = first.get('s24')!, q25 = first.get('s25')!;
    expect(q24.id).toBeGreaterThanOrEqual(QUEUE_ID_BASE);
    // sin cambios: la cola tampoco se reacomoda
    const same = assign(many(26), first);
    expect(same.get('s25')!.id).toBe(q25.id);
    // se cierra uno sentado: el primero de la cola (el que llegó antes) toma su puesto
    const snaps = many(26);
    const freed = first.get('s0')!.id;
    snaps[0] = snap(0, 'closed');
    const after = assign(snaps, first);
    expect(after.get('s24')!.id).toBe(freed);
    expect(after.get('s25')!.id).toBe(q25.id);
  });

  it('few_sessions_take_aisle_side_seats_first', () => {
    const m = assign(many(8));
    const inner = (s: Seat) => Math.abs(s.position.z - L.room.aisleZ) < Math.abs(L.islands[s.island]!.zc - L.room.aisleZ);
    expect([...m.values()].every(inner)).toBe(true);
  });

  it('queue_spots_are_deterministic', () => {
    expect(queueSpot(0)).toEqual(queueSpot(0));
    expect(queueSpot(3).id).toBe(QUEUE_ID_BASE + 3);
    expect(queueSpot(3).island).toBe(-2);
  });
});
