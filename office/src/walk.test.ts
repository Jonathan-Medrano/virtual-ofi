import { describe, it, expect } from 'vitest';
import {
  stepPlayer, spawnAtDoor, walkWorld, pickTarget, playerFree, NO_INPUT, PITCH_LIMIT, WALK_SPEED_P, RUN_SPEED_P, PLAYER_RADIUS,
  type PlayerState, type WalkInput, type WalkWorld,
} from './walk';
import { officeLayout, ROOM } from './layout';

const world = walkWorld();
const L = officeLayout();
const input = (o: Partial<WalkInput>): WalkInput => ({ ...NO_INPUT, ...o });
/** Camina `secs` segundos a 60 fps con la misma entrada. */
function walk(s: PlayerState, inp: WalkInput, secs: number, w: WalkWorld = world): PlayerState {
  for (let t = 0; t < secs; t += 1 / 60) s = stepPlayer(s, inp, 1 / 60, w);
  return s;
}
/** yaw para mirar hacia (dx, dz): el frente es (sin(yaw), cos(yaw)), como `Seat.facing`. */
const yawTo = (dx: number, dz: number) => Math.atan2(dx, dz);

describe('modo recorrido (primera persona)', () => {
  it('spawns_in_free_spot_at_door', () => {
    const s = spawnAtDoor(world);
    expect(playerFree(s, world)).toBe(true);
    expect(s.x).toBeLessThan(1.5);
    expect(Math.abs(s.z)).toBeLessThan(1.0);       // frente a la puerta (z de -1 a 1)
    expect(Math.sin(s.yaw)).toBeGreaterThan(0.9);   // mirando hacia el fondo (+x)
    expect(s.pitch).toBe(0);
  });

  it('cannot_walk_through_island', () => {
    const desk = L.props.find(p => p.kind === 'desk' && p.island === 2)!;
    // del pasillo, a la altura del mueble de plantas de la isla, caminando derecho hacia la pared de la isla (+z)
    const cab = L.props.find(p => p.kind === 'cabinet' && p.island === 2)!;
    let s: PlayerState = { x: cab.x, z: ROOM.aisleZ, yaw: yawTo(0, 1), pitch: 0 };
    expect(playerFree(s, world)).toBe(true);
    s = walk(s, input({ forward: 1 }), 4);
    expect(playerFree(s, world)).toBe(true);
    expect(s.z).toBeLessThan(cab.z - cab.d / 2);
    // y por adentro de la isla tampoco: de la cabecera hacia la mesa (+x) se frena antes del mueble
    let t: PlayerState = { x: cab.x - 1.2, z: desk.z, yaw: yawTo(1, 0), pitch: 0 };
    expect(playerFree(t, world)).toBe(true);
    t = walk(t, input({ forward: 1, run: true }), 4);
    expect(t.x).toBeLessThan(cab.x - cab.w / 2);
    expect(playerFree(t, world)).toBe(true);
  });

  it('slides_along_wall', () => {
    // pegado a la pared de fondo, empujando en diagonal: no la atraviesa pero avanza de costado
    const s0: PlayerState = { x: ROOM.length - 1, z: -3.4, yaw: yawTo(1, 1), pitch: 0 };   // entre la planta del rincón y las del fondo
    expect(playerFree(s0, world)).toBe(true);
    const s = walk(s0, input({ forward: 1 }), 1.5);
    expect(s.x).toBeLessThanOrEqual(ROOM.length - PLAYER_RADIUS + 1e-9);
    expect(s.z - s0.z).toBeGreaterThan(0.5);        // se deslizó a lo largo de la pared
    expect(playerFree(s, world)).toBe(true);
  });

  it('cannot_leave_bounds', () => {
    // por la puerta hacia afuera, corriendo varios segundos
    let s = spawnAtDoor(world);
    s = walk({ ...s, yaw: yawTo(-1, 0) }, input({ forward: 1, run: true }), 5);
    expect(s.x).toBeGreaterThanOrEqual(world.bounds.x0 + PLAYER_RADIUS - 1e-9);
    // hacia la pared lateral y el techo de la sala (fondo) tampoco
    for (const [dx, dz] of [[0, 1], [0, -1], [1, 0]] as const) {
      let t = spawnAtDoor(world);
      t = walk({ ...t, yaw: yawTo(dx, dz) }, input({ forward: 1, run: true }), 12);
      expect(t.x).toBeGreaterThanOrEqual(world.bounds.x0);
      expect(t.x).toBeLessThanOrEqual(world.bounds.x1);
      expect(t.z).toBeGreaterThanOrEqual(world.bounds.z0);
      expect(t.z).toBeLessThanOrEqual(world.bounds.z1);
      expect(playerFree(t, world)).toBe(true);
    }
  });

  it('run_is_faster', () => {
    const s0: PlayerState = { x: 3.4, z: ROOM.aisleZ, yaw: yawTo(1, 0), pitch: 0 };
    const w = walk(s0, input({ forward: 1 }), 1);
    const r = walk(s0, input({ forward: 1, run: true }), 1);
    expect(w.x - s0.x).toBeCloseTo(WALK_SPEED_P, 1);
    expect(r.x - s0.x).toBeCloseTo(RUN_SPEED_P, 1);
    expect(r.x - s0.x).toBeGreaterThan((w.x - s0.x) * 1.5);
    // en diagonal no va más rápido
    const d = walk(s0, input({ forward: 1, strafe: 1 }), 1);
    expect(Math.hypot(d.x - s0.x, d.z - s0.z)).toBeLessThanOrEqual(WALK_SPEED_P + 1e-6);
  });

  it('does_not_get_stuck_in_corner', () => {
    // rincón entre la pared de entrada y la pared lateral (con una planta en la esquina): empuja contra el rincón y después
    // tiene que poder salir caminando en cualquier dirección que no sea hacia el rincón
    let s: PlayerState = { x: 1.2, z: ROOM.width / 2 - 1.2, yaw: yawTo(-1, 1), pitch: 0 };
    expect(playerFree(s, world)).toBe(true);
    s = walk(s, input({ forward: 1, run: true }), 3);
    expect(playerFree(s, world)).toBe(true);
    const out = walk(s, input({ forward: -1 }), 1);
    expect(Math.hypot(out.x - s.x, out.z - s.z)).toBeGreaterThan(0.8);
    // y una esquina interior entre la silla de un puesto y su mesa
    const seat = L.seats.find(x => x.island === 0)!;
    let c: PlayerState = { x: seat.position.x - 0.7, z: ROOM.aisleZ, yaw: yawTo(1, -1), pitch: 0 };
    expect(playerFree(c, world)).toBe(true);
    c = walk(c, input({ forward: 1 }), 2);
    expect(playerFree(c, world)).toBe(true);
    const back = walk(c, input({ forward: -1 }), 1);
    expect(Math.hypot(back.x - c.x, back.z - c.z)).toBeGreaterThan(0.8);
  });

  it('keeps_head_out_of_plant_foliage', () => {
    // las hojas salen bastante más que la maceta: caminando contra una planta de pared no se mete la cámara entre las hojas
    const plant = L.props.find(p => p.kind === 'plant' && p.x === 8.4 && p.z > 0)!;
    let s: PlayerState = { x: plant.x, z: ROOM.aisleZ + 0.6, yaw: yawTo(0, 1), pitch: 0 };
    expect(playerFree(s, world)).toBe(true);
    s = walk(s, input({ forward: 1 }), 4);
    expect(Math.hypot(s.x - plant.x, s.z - plant.z)).toBeGreaterThanOrEqual(0.75);
    // y la maceta grande del pasillo tampoco
    const pl = L.props.find(p => p.kind === 'planter')!;
    let t: PlayerState = { x: pl.x - 2, z: pl.z, yaw: yawTo(1, 0), pitch: 0 };
    t = walk(t, input({ forward: 1 }), 3);
    expect(pl.x - t.x).toBeGreaterThanOrEqual(0.69);
  });

  it('does_not_walk_through_seated_people', () => {
    // alguien sentado en el pasillo (la planta no está ahí: es un mundo de prueba sin muebles)
    const empty: WalkWorld = { ...world, rects: [], people: [{ x: 5, z: 0 }] };
    let s: PlayerState = { x: 3, z: 0, yaw: yawTo(1, 0), pitch: 0 };
    s = walk(s, input({ forward: 1 }), 3, empty);
    expect(s.x).toBeLessThan(5 - PLAYER_RADIUS);
  });

  it('escapes_if_someone_sits_where_it_stands', () => {
    const empty: WalkWorld = { ...world, rects: [], people: [{ x: 5, z: 0.1 }] };
    const s0: PlayerState = { x: 5, z: 0, yaw: yawTo(1, 0), pitch: 0 };
    expect(playerFree(s0, empty)).toBe(false);
    const s = walk(s0, input({ forward: -1 }), 1, empty);
    expect(playerFree(s, empty)).toBe(true);
  });

  it('looks_pitch_is_clamped', () => {
    const s0 = spawnAtDoor(world);
    const up = stepPlayer(s0, input({ lookPitch: 10 }), 1 / 60, world);
    expect(up.pitch).toBeCloseTo(PITCH_LIMIT, 6);
    const down = stepPlayer(s0, input({ lookPitch: -10 }), 1 / 60, world);
    expect(down.pitch).toBeCloseTo(-PITCH_LIMIT, 6);
    expect(PITCH_LIMIT).toBeLessThan(Math.PI / 2);
    // el giro horizontal no tiene tope pero queda normalizado
    const turned = stepPlayer(s0, input({ lookYaw: 100 }), 1 / 60, world);
    expect(Math.abs(turned.yaw)).toBeLessThanOrEqual(Math.PI);
    // mirar no mueve
    expect(up.x).toBe(s0.x); expect(up.z).toBe(s0.z);
  });

  it('target_picks_nearest_character_in_view', () => {
    const eye: PlayerState = { x: 2, z: 0, yaw: yawTo(1, 0), pitch: 0 };
    const chars = [
      { id: 'lejos', x: 6, z: 0.1, h: 1.3 },
      { id: 'cerca', x: 4, z: -0.1, h: 1.3 },
      { id: 'costado', x: 3, z: 2.5, h: 1.3 },     // cerca pero fuera de la mira
      { id: 'atras', x: 1, z: 0, h: 1.3 },
    ];
    expect(pickTarget(eye, chars)?.id).toBe('cerca');
    // fuera de alcance (más de 6 m)
    expect(pickTarget(eye, [{ id: 'muy-lejos', x: 9, z: 0, h: 1.5 }])).toBeNull();
    // mirando al de costado lo elige a él
    expect(pickTarget({ ...eye, yaw: yawTo(1, 2.5) }, chars)?.id).toBe('costado');
    // mirando al techo no elige a nadie
    expect(pickTarget({ ...eye, pitch: PITCH_LIMIT }, chars)).toBeNull();
  });
});
