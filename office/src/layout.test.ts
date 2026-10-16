import { describe, expect, it } from 'vitest';
import { officeLayout, ROOM, AISLE_PROP_KINDS, type Prop } from './layout';

const L = officeLayout();
const all = [...L.seats, ...L.extraSeats];

/** Ancho libre entre los bordes de mesa de las dos filas de islas (lo midió el usuario: "entran de pedo 3,5 personas"). */
const DESK_GAP = 2.6;
/** ¿El rectángulo del mueble (centro x,z; medidas w en x, d en z) pisa la franja libre del pasillo |z - aisleZ| < aisleHalf? */
const inAisle = (p: Prop) => p.z - p.d / 2 < ROOM.aisleZ + ROOM.aisleHalf && p.z + p.d / 2 > ROOM.aisleZ - ROOM.aisleHalf;

describe('layout de la oficina', () => {
  it('has_16_seats_in_4_islands', () => {
    expect(L.seats).toHaveLength(16);
    expect(L.islands).toHaveLength(4);
    expect(new Set(L.seats.map(s => s.island))).toEqual(new Set([0, 1, 2, 3]));
    expect(new Set(L.seats.map(s => s.id)).size).toBe(16);
  });

  it('each_island_has_4', () => {
    for (const isl of L.islands) {
      const own = L.seats.filter(s => s.island === isl.id);
      expect(own).toHaveLength(4);
      // 2 por cada lado largo de la mesa
      expect(own.filter(s => Math.abs(s.position.z) > Math.abs(isl.zc))).toHaveLength(2);
      expect(own.filter(s => Math.abs(s.position.z) < Math.abs(isl.zc))).toHaveLength(2);
    }
  });

  it('two_islands_per_wall', () => {
    expect(L.islands.filter(i => i.wall === -1)).toHaveLength(2);
    expect(L.islands.filter(i => i.wall === 1)).toHaveLength(2);
    // cada isla tiene su mueble con plantas del lado de la entrada
    for (const isl of L.islands) {
      const cab = L.props.find(p => p.kind === 'cabinet' && p.island === isl.id);
      expect(cab, `mueble de la isla ${isl.id}`).toBeDefined();
      expect(cab!.x).toBeLessThan(isl.x0);
    }
  });

  it('no_two_seats_overlap', () => {
    expect(all.length).toBeGreaterThan(16);
    const ids = new Set(all.map(s => s.id));
    expect(ids.size).toBe(all.length);
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const a = all[i]!.position, b = all[j]!.position;
      expect(Math.hypot(a.x - b.x, a.z - b.z), `asientos ${all[i]!.id} y ${all[j]!.id}`).toBeGreaterThanOrEqual(0.8);
    }
    for (const s of all) {
      expect(s.position.x).toBeGreaterThan(0.5);
      expect(s.position.x).toBeLessThan(ROOM.length - 0.5);
      expect(Math.abs(s.position.z)).toBeLessThan(ROOM.width / 2 - 0.3);
      expect(Number.isFinite(s.facing)).toBe(true);
    }
  });

  it('aisle_is_clear', () => {
    // ningún puesto de isla en la franja del pasillo
    const left = L.islands.filter(i => i.wall === -1), right = L.islands.filter(i => i.wall === 1);
    // las islas de la derecha (z > 0) no se movieron; las de la izquierda se acercaron hasta dejar 2,6 m entre bordes de mesa
    for (const r of right) expect(r.zc).toBeCloseTo(3.1, 5);
    for (const l of left) for (const r of right) expect((r.zc - r.depth / 2) - (l.zc + l.depth / 2)).toBeCloseTo(DESK_GAP, 5);
    // el pasillo libre queda centrado entre las dos filas de mesas
    expect(ROOM.aisleZ).toBeCloseTo(((right[0]!.zc - right[0]!.depth / 2) + (left[0]!.zc + left[0]!.depth / 2)) / 2, 5);
    for (const s of L.seats) expect(Math.abs(s.position.z - ROOM.aisleZ), `asiento ${s.id}`).toBeGreaterThanOrEqual(ROOM.aisleHalf + 0.3 - 1e-9);
    // en el pasillo solo puede haber plantas y bancos
    const intruders = L.props.filter(p => inAisle(p) && !AISLE_PROP_KINDS.includes(p.kind));
    expect(intruders).toEqual([]);
    // y sí hay plantas y bancos en el centro
    expect(L.props.some(p => inAisle(p) && p.kind === 'bench')).toBe(true);
    expect(L.props.some(p => inAisle(p) && (p.kind === 'planter' || p.kind === 'plant'))).toBe(true);
  });

  it('aisle_benches_flank_the_planter_and_leave_room_to_walk', () => {
    const planters = L.props.filter(p => p.kind === 'planter');
    expect(planters.length).toBeGreaterThan(0);
    for (const pl of planters) {
      // UN banco sin respaldo a cada lado de la planta, de ~1 m, con el eje largo de lado a lado del salón (a lo largo de z)
      const benches = L.props.filter(p => p.kind === 'bench' && Math.abs(p.x - pl.x) < 0.01);
      expect(benches).toHaveLength(2);
      expect(benches.some(b => b.z < pl.z - pl.d / 2) && benches.some(b => b.z > pl.z + pl.d / 2)).toBe(true);
      for (const b of benches) {
        expect(b.d).toBeGreaterThan(b.w);                       // eje largo a lo ancho del salón
        expect(b.d).toBeGreaterThanOrEqual(0.9);
        expect(b.d).toBeLessThanOrEqual(1.1);
        // 2 lugares por banco, sobre el banco
        const on = L.extraSeats.filter(s => Math.abs(s.position.x - b.x) < b.w / 2 && Math.abs(s.position.z - b.z) < b.d / 2);
        expect(on).toHaveLength(2);
        // para pasar: ≥ 0,8 m libres entre la punta del banco y cualquier otro mueble en esa franja de x
        const rel = (z: number) => z - ROOM.aisleZ;
        const end = Math.abs(rel(b.z)) + b.d / 2;
        const blockers = L.props.filter(p => p !== b && Math.abs(p.x - b.x) < (p.w + b.w) / 2 && Math.sign(rel(p.z)) === Math.sign(rel(b.z))
          && Math.abs(rel(p.z)) - p.d / 2 < end + 0.8 && Math.abs(rel(p.z)) + p.d / 2 > end);
        expect(blockers).toEqual([]);
      }
    }
    // nada de muebles con respaldo en el pasillo
    expect(L.props.some(p => (p.kind as string) === 'sofa' || (p.kind as string) === 'armchair')).toBe(false);
  });

  it('plants_in_the_4_corners', () => {
    const corners = [[0, -1], [0, 1], [ROOM.length, -1], [ROOM.length, 1]] as const;
    for (const [cx, sz] of corners) {
      const near = L.props.filter(p => p.kind === 'plant' && Math.abs(p.x - cx) < 0.6 && Math.abs(p.z - sz * ROOM.width / 2) < 0.6);
      expect(near, `esquina ${cx},${sz}`).toHaveLength(1);
    }
  });

  it('seats_face_their_desk', () => {
    for (const s of L.seats) {
      const isl = L.islands[s.island]!;
      // facing = giro en Y: el frente (+z local) apunta a (sin f, cos f); tiene que ir hacia el centro de la mesa
      const dz = Math.cos(s.facing);
      expect(Math.sign(dz)).toBe(Math.sign(isl.zc - s.position.z));
    }
  });
});
