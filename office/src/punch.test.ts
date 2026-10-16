import { describe, it, expect } from 'vitest';
import {
  pickPunchTarget, tryPunch, stepPunch, punchExtension, startReaction, stepReaction, reactionPose, PUNCH_IDLE,
  PUNCH_RANGE, PUNCH_COOLDOWN, PUNCH_TIME, REACT_TIME,
} from './punch';
import { walkWorld, type PlayerState } from './walk';
import { createAgent, stepAgent, CHAR_RADIUS } from './behavior';
import { officeLayout } from './layout';

const yawTo = (dx: number, dz: number) => Math.atan2(dx, dz);
const me: PlayerState = { x: 3, z: 0, yaw: yawTo(1, 0), pitch: 0 };
const world = walkWorld();

describe('golpe en modo recorrido', () => {
  it('punch_hits_nearest_in_front', () => {
    const chars = [
      { id: 'adelante', x: 4.0, z: 0.05 },
      { id: 'diagonal', x: 3.8, z: 0.4 },     // más cerca pero más lejos del centro de la vista
      { id: 'costado', x: 3.0, z: 1.0 },      // 90°: fuera del cono
    ];
    expect(pickPunchTarget(me, chars)?.id).toBe('adelante');
  });

  it('punch_misses_when_too_far', () => {
    expect(pickPunchTarget(me, [{ id: 'lejos', x: 3 + PUNCH_RANGE + 0.2, z: 0 }])).toBeNull();
  });

  it('punch_misses_behind', () => {
    expect(pickPunchTarget(me, [{ id: 'atras', x: 2.2, z: 0 }])).toBeNull();
  });

  it('cooldown_blocks_second_punch', () => {
    const a = tryPunch(PUNCH_IDLE);
    expect(a.fired).toBe(true);
    const b = tryPunch(stepPunch(a.state, PUNCH_COOLDOWN * 0.5));
    expect(b.fired).toBe(false);
    const c = tryPunch(stepPunch(a.state, PUNCH_COOLDOWN + 0.01));
    expect(c.fired).toBe(true);
    // la animación va y vuelve en PUNCH_TIME
    expect(punchExtension(stepPunch(a.state, PUNCH_TIME / 2))).toBeGreaterThan(0.9);
    expect(punchExtension(stepPunch(a.state, PUNCH_TIME + 0.01))).toBe(0);
    expect(punchExtension(PUNCH_IDLE)).toBe(0);
  });

  it('knockback_stops_at_wall', () => {
    // alguien parado contra la pared de entrada, golpeado desde adentro: se tambalea hacia la pared sin atravesarla
    const r = startReaction('x', false, { x: 1.2, z: 0 }, { x: 0.3, z: 0 });
    let maxBack = 0;
    for (let t = 0; t < REACT_TIME; t += 1 / 60) {
      const p = reactionPose(stepReaction(r, t)!, { x: 0.3, z: 0 }, world);
      expect(0.3 + p.dx).toBeGreaterThanOrEqual(CHAR_RADIUS - 1e-9);
      maxBack = Math.max(maxBack, -p.dx);
    }
    expect(maxBack).toBeLessThanOrEqual(0.3 - CHAR_RADIUS + 1e-9);
    // en el medio del pasillo sí retrocede
    const free = startReaction('y', false, { x: 4, z: 1.05 }, { x: 5, z: 1.05 });
    expect(reactionPose(stepReaction(free, 0.3)!, { x: 5, z: 1.05 }, world).dx).toBeGreaterThan(0.15);
    // termina en ~1 s y vuelve a su lugar
    expect(stepReaction(r, REACT_TIME + 0.01)).toBeNull();
  });

  it('seated_only_flinches', () => {
    const r = startReaction('s', true, { x: 4, z: 1.05 }, { x: 5, z: 0.3 });
    expect(r.kind).toBe('flinch');
    for (let t = 0; t < REACT_TIME; t += 0.05) {
      const p = reactionPose(stepReaction(r, t)!, { x: 5, z: 0.3 }, world);
      expect(p.dx).toBe(0); expect(p.dz).toBe(0);
    }
  });

  it('punch_does_not_change_session_status', () => {
    const seat = officeLayout().seats[0]!;
    const a = createAgent(seat, { start: 'seat', seed: 3 });
    const b = createAgent(seat, { start: 'seat', seed: 3 });
    const target = pickPunchTarget({ x: seat.position.x, z: seat.position.z - 1, yaw: 0, pitch: 0 }, [{ id: 'a', x: a.pos.x, z: a.pos.z }]);
    expect(target?.id).toBe('a');
    const r = startReaction('a', true, { x: seat.position.x, z: seat.position.z - 1 }, a.pos);
    for (let t = 0; t < 1.2; t += 0.1) reactionPose(stepReaction(r, t) ?? r, a.pos, world);
    // el golpe es solo visual: el agente sigue idéntico a uno que no recibió nada
    for (let k = 0; k < 30; k++) { stepAgent(a, 'working', 0.05); stepAgent(b, 'working', 0.05); }
    expect(a).toEqual(b);
  });
});
