import { describe, expect, it } from 'vitest';
import { officeLayout, ROOM, AISLE_PROP_KINDS, type Prop } from './layout';

const L = officeLayout();
const all = [...L.seats, ...L.extraSeats];

/** ¿El rectángulo del mueble (centro x,z; medidas w en x, d en z) pisa la franja del pasillo |z| < aisleHalf? */
const inAisle = (p: Prop) => p.z - p.d / 2 < ROOM.aisleHalf && p.z + p.d / 2 > -ROOM.aisleHalf;

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
    for (const s of L.seats) expect(Math.abs(s.position.z), `asiento ${s.id}`).toBeGreaterThanOrEqual(ROOM.aisleHalf + 0.3);
    // en el pasillo solo puede haber plantas y sillones
    const intruders = L.props.filter(p => inAisle(p) && !AISLE_PROP_KINDS.includes(p.kind));
    expect(intruders).toEqual([]);
    // y sí hay plantas y sillones en el centro
    expect(L.props.some(p => inAisle(p) && p.kind === 'bench')).toBe(true);
    expect(L.props.some(p => inAisle(p) && (p.kind === 'planter' || p.kind === 'plant'))).toBe(true);
    // los lugares extra de los sillones caen en el pasillo
    expect(L.extraSeats.every(s => Math.abs(s.position.z) < ROOM.aisleHalf)).toBe(true);
  });

  it('aisle_benches_flank_the_planter_and_leave_room_to_walk', () => {
    const planters = L.props.filter(p => p.kind === 'planter');
    expect(planters.length).toBeGreaterThan(0);
    for (const pl of planters) {
      // un banco sin respaldo a cada lado de la planta, a lo ancho del pasillo (misma x, z a izquierda y derecha)
      const benches = L.props.filter(p => p.kind === 'bench' && Math.abs(p.x - pl.x) < 0.01);
      expect(benches).toHaveLength(2);
      expect(benches.some(b => b.z < pl.z - pl.d / 2) && benches.some(b => b.z > pl.z + pl.d / 2)).toBe(true);
      // queda al menos 0,5 m libre entre el banco y el borde del pasillo para pasar
      for (const b of benches) expect(ROOM.aisleHalf - (Math.abs(b.z) + b.d / 2)).toBeGreaterThanOrEqual(0.5);
    }
    // nada de sillones con respaldo en el pasillo
    expect(L.props.some(p => (p.kind as string) === 'sofa' || (p.kind as string) === 'armchair')).toBe(false);
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
