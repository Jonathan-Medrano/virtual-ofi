// Plano de la oficina: puro (sin three), testeable. Todas las medidas en metros (1 unidad = 1 m).
// Ejes: x a lo largo del salón (0 = entrada, ROOM.length = pared de fondo acanalada), z a lo ancho (centro del pasillo = 0),
// y arriba (piso = 0). Las islas van pegadas a las paredes laterales (z < 0 y z > 0), con el mueble de plantas del lado de la
// entrada, y el pasillo largo queda en el medio: |z| < aisleHalf.

export interface Vec3 { x: number; y: number; z: number }

/**
 * Un lugar donde se ubica un personaje.
 * - `position`: punto en el PISO (y = 0) donde está la silla o el lugar; la altura del asiento es `SEAT_HEIGHT`.
 * - `facing`: giro en Y (radianes) para que el frente del personaje (+z local, como los modelos voxel de la fábrica) mire a su
 *   escritorio/monitor: el frente queda apuntando a (sin(facing), 0, cos(facing)). Para usarlo: `obj.rotation.y = seat.facing`.
 * - `island`: 0..3 para los puestos de las islas; -1 para los lugares extra (sillones del pasillo).
 */
export interface Seat { id: number; position: Vec3; facing: number; island: number }

export type PropKind = 'desk' | 'cabinet' | 'chair' | 'column' | 'plant' | 'planter' | 'bench';

/** Un mueble en planta: centro (x, z), medidas ya giradas (w a lo largo de x, d a lo largo de z) y giro para el modelo. */
export interface Prop { kind: PropKind; x: number; z: number; w: number; d: number; rot: number; island?: number; seats?: number; size?: number }

/** Isla de 4 puestos: mesa doble (dos escritorios espalda con espalda) entre x0 y x1, centrada en zc, pegada a la pared `wall`. */
export interface Island { id: number; wall: -1 | 1; x0: number; x1: number; zc: number; depth: number }

export const ROOM = { length: 20, width: 9.6, height: 3.6, aisleHalf: 1.4 } as const;
/** Altura del asiento de las sillas y sillones. */
export const SEAT_HEIGHT = 0.46;
/** Lo único que puede estar dentro de la franja del pasillo. */
export const AISLE_PROP_KINDS: readonly PropKind[] = ['plant', 'planter', 'bench'];

const DESK_LEN = 2.8;      // largo de la isla (a lo largo del salón): 2 puestos de 1,4 m por lado
const DESK_DEPTH = 1.5;    // dos escritorios de 0,75 m espalda con espalda
const CHAIR_OFF = 0.55;    // del borde de la mesa al centro de la silla
const ISLAND_ZC = 3.1;     // centro de las islas respecto del eje del pasillo
const ISLAND_X0 = [4.5, 11.5];
const CAB_DEPTH = 0.6;     // mueble de plantas (a lo largo de x)
const COLUMN_X = [2.6, 9.4, 16.2];
const LOUNGE_X = [9.15, 17.2];

export interface OfficeLayout {
  room: typeof ROOM;
  islands: Island[];
  seats: Seat[];
  extraSeats: Seat[];
  props: Prop[];
  /** Lámparas colgantes (posición del pantallón, y = altura de la boca). */
  lamps: Vec3[];
}

export function officeLayout(): OfficeLayout {
  const islands: Island[] = [];
  const seats: Seat[] = [];
  const extraSeats: Seat[] = [];
  const props: Prop[] = [];
  const lamps: Vec3[] = [];

  // Islas: 0 y 1 contra la pared z < 0; 2 y 3 contra la pared z > 0 (de la entrada al fondo).
  for (const wall of [-1, 1] as const) {
    for (const x0 of ISLAND_X0) {
      const id = islands.length;
      const zc = wall * ISLAND_ZC;
      const isl: Island = { id, wall, x0, x1: x0 + DESK_LEN, zc, depth: DESK_DEPTH };
      islands.push(isl);
      const xc = x0 + DESK_LEN / 2;
      props.push({ kind: 'desk', x: xc, z: zc, w: DESK_LEN, d: DESK_DEPTH, rot: 0, island: id });
      // Mueble gris + madera con 3 plantas, delante de la mesa (del lado de la entrada), mirando al pasillo.
      props.push({ kind: 'cabinet', x: x0 - CAB_DEPTH / 2 - 0.05, z: zc, w: CAB_DEPTH, d: DESK_DEPTH, rot: 0, island: id });
      // 2 puestos por lado: el lado de la pared (|z| mayor) y el lado del pasillo.
      for (const side of [1, -1]) {
        const z = zc + wall * side * (DESK_DEPTH / 2 + CHAIR_OFF);
        for (const dx of [0.7, 2.1]) {
          const x = x0 + dx;
          // mira hacia el centro de la mesa: +z si la mesa está en z mayor
          const facing = zc > z ? 0 : Math.PI;
          seats.push({ id: seats.length, position: { x, y: 0, z }, facing, island: id });
          props.push({ kind: 'chair', x, z, w: 0.6, d: 0.6, rot: facing, island: id });
        }
      }
      // lámpara colgante sobre el centro de cada isla y otra sobre el borde del pasillo
      lamps.push({ x: xc - 0.7, y: 2.45, z: zc * 0.62 }, { x: xc + 0.7, y: 2.45, z: zc * 0.62 });
    }
  }

  // Columnas revestidas en OSB contra las paredes laterales.
  for (const x of COLUMN_X) for (const wall of [-1, 1]) {
    props.push({ kind: 'column', x, z: wall * (ROOM.width / 2 - 0.25), w: 0.6, d: 0.5, rot: 0 });
  }

  // Centro del pasillo: maceta con una planta mediana y UN banco sin respaldo a cada lado (izquierda y derecha), de 1 m, con el eje
  // largo de lado a lado del salón: una punta hacia la planta y la otra hacia su pared. Cada banco tiene 2 lugares extra (sesiones de
  // más), sentados mirando a lo largo del pasillo, hacia la entrada (-x: de frente a la cámara habitual). Estos descansos caen entre
  // islas (no hay sillas al lado) y dejan ≥ 0,8 m libres más allá de la punta de cada banco para pasar.
  const PLANTER = 0.7, BENCH_LEN = 1.0, BENCH_D = 0.42, GAP = 0.08;
  for (const xc of LOUNGE_X) {
    props.push({ kind: 'planter', x: xc, z: 0, w: PLANTER, d: PLANTER, rot: 0 });
    for (const side of [-1, 1]) {
      const bz = side * (PLANTER / 2 + GAP + BENCH_LEN / 2);
      props.push({ kind: 'bench', x: xc, z: bz, w: BENCH_D, d: BENCH_LEN, rot: Math.PI / 2, seats: 2 });
      for (const dz of [-0.4, 0.4]) {
        extraSeats.push({ id: 16 + extraSeats.length, position: { x: xc, y: 0, z: bz + dz }, facing: -Math.PI / 2, island: -1 });
      }
    }
  }

  // Plantas medianas en las 4 esquinas, pegadas al rincón (no tapan columnas ni el fondo acanalado).
  for (const x of [0.4, ROOM.length - 0.4]) for (const wall of [-1, 1]) {
    props.push({ kind: 'plant', x, z: wall * (ROOM.width / 2 - 0.4), w: 0.6, d: 0.6, rot: 0, size: 0.8 });
  }

  // Muchas plantas: entre columnas, contra las paredes (fuera del pasillo).
  const wallPlants: Array<[number, number]> = [[8.4, 0.75], [15.1, 0.8], [18.2, 0.8]];
  for (const [x, size] of wallPlants) for (const wall of [-1, 1]) {
    props.push({ kind: 'plant', x, z: wall * (ROOM.width / 2 - 0.45), w: 0.6, d: 0.6, rot: 0, size });
  }
  // dos más en el centro del pasillo, al fondo, junto a la pared acanalada
  props.push({ kind: 'plant', x: 19.4, z: -0.9, w: 0.6, d: 0.6, rot: 0, size: 0.8 }, { kind: 'plant', x: 19.4, z: 0.9, w: 0.6, d: 0.6, rot: 0, size: 0.9 });

  return { room: ROOM, islands, seats, extraSeats, props, lamps };
}
