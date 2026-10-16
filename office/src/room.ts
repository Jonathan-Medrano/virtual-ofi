// El salón: cáscara (paredes, techo, fondo acanalado), techo técnico (vigas, bandeja de cables, spots), lámparas y muebles,
// todo fundido en UNA malla con color por vértice (MeshBasicMaterial: el sombreado ya viene horneado por cara, cero luces en
// tiempo real) + su reflejo espejado bajo el piso + el piso pulido semitransparente encima. Total: 3 draw calls para todo el salón.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { officeLayout, ROOM, type OfficeLayout, type Seat } from './layout';
import {
  PAL, armchairGeometry, cabinetGeometry, chairGeometry, columnGeometry, deskGeometry, lampGeometry, planterGeometry,
  plantGeometry, sofaGeometry,
} from './furniture';

// Brillo horneado por dirección (igual que la grilla voxel de kit3d): +x -x +y -y +z -z.
const SHADE = [0.78, 0.68, 1.0, 0.5, 0.9, 0.62];

/** Caja con los mismos atributos que la malla voxel (position, color, normal, glow), para fundirla con los muebles. */
export function boxGeo(
  x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
  color: THREE.ColorRepresentation, o: { glow?: boolean; shade?: number[] } = {},
): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const shade = o.shade ?? SHADE;
  const pos: number[] = [], col: number[] = [], nor: number[] = [], gl: number[] = [], idx: number[] = [];
  // [normal, 4 esquinas en sentido antihorario visto desde afuera]
  const faces: Array<[number[], number[][]]> = [
    [[1, 0, 0], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]],
    [[-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]],
    [[0, 1, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]],
    [[0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
    [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
    [[0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]],
  ];
  faces.forEach(([n, q], i) => {
    const k = o.glow ? 1.15 : shade[i]!;
    const base = pos.length / 3;
    for (const p of q) { pos.push(p[0]!, p[1]!, p[2]!); col.push(c.r * k, c.g * k, c.b * k); nor.push(n[0]!, n[1]!, n[2]!); gl.push(o.glow ? 1 : 0); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('glow', new THREE.Float32BufferAttribute(gl, 1));
  geo.setIndex(idx);
  return geo;
}

const M = new THREE.Matrix4();
/** Copia de `geo` girada en Y y llevada a (x, y, z). */
function place(geo: THREE.BufferGeometry, x: number, y: number, z: number, rotY = 0): THREE.BufferGeometry {
  return geo.clone().applyMatrix4(M.makeRotationY(rotY).setPosition(x, y, z));
}

/** Paredes con luz pareja (las dos laterales no deben verse una clara y otra oscura). */
const FLAT = [0.86, 0.86, 1, 0.55, 0.86, 0.86];

function shellParts(L: OfficeLayout): THREE.BufferGeometry[] {
  const { length: X, width: W, height: H } = ROOM;
  const hw = W / 2, T = 0.2, ZOC = 1.15;
  const out: THREE.BufferGeometry[] = [];
  const add = (...a: Parameters<typeof boxGeo>) => out.push(boxGeo(...a));

  // paredes laterales: blancas arriba, zócalo negro acanalado abajo
  for (const s of [-1, 1]) {
    const z0 = s < 0 ? -hw - T : hw, z1 = s < 0 ? -hw : hw + T;
    add(0, ZOC, z0, X, H, z1, PAL.wall, { shade: FLAT });
    add(0, 0, z0, X, ZOC, z1, PAL.black, { shade: FLAT });
    const zi = s < 0 ? -hw : hw - 0.03;
    for (let x = 0.1; x < X; x += 0.16) add(x, 0, zi, x + 0.07, ZOC, zi + 0.03, PAL.black2, { shade: FLAT });
    add(0, ZOC, zi, X, ZOC + 0.03, zi + 0.03, PAL.black2, { shade: FLAT });
  }
  // pared de entrada (blanca con zócalo y una puerta de vidrio oscuro)
  add(-T, ZOC, -hw, 0, H, hw, PAL.wall, { shade: FLAT });
  add(-T, 0, -hw, 0, ZOC, hw, PAL.black, { shade: FLAT });
  add(-0.02, 0, -1.0, 0.02, 2.2, 1.0, PAL.black2, { shade: FLAT });
  add(-0.01, 0.08, -0.92, 0.03, 2.12, 0.92, 0x3a4048, { shade: FLAT });
  // pared de fondo: chapa negra acanalada de piso a techo
  add(X, 0, -hw, X + T, H, hw, PAL.black, { shade: FLAT });
  for (let z = -hw + 0.06; z < hw; z += 0.2) add(X - 0.05, 0, z, X, H, z + 0.09, PAL.black2, { shade: [0.9, 0.9, 1, 0.5, 1.1, 0.75] });

  // techo negro con chapa acanalada, vigas transversales y bandeja de cables
  add(-T, H, -hw - T, X + T, H + 0.1, hw + T, PAL.black);
  for (let z = -hw + 0.1; z < hw; z += 0.3) add(0, H - 0.07, z, X, H, z + 0.11, PAL.black2);   // chapa del techo, a lo largo
  for (let x = 0.8; x < X; x += 2.2) {
    add(x - 0.03, H - 0.32, -hw, x + 0.03, H - 0.06, hw, PAL.black);          // alma
    add(x - 0.09, H - 0.35, -hw, x + 0.09, H - 0.32, hw, PAL.black2);         // ala inferior
  }
  const TY = H - 0.55;
  const tray = (alongX: boolean, a0: number, a1: number, c: number) => {
    const b = (u0: number, y0: number, v0: number, u1: number, y1: number, v1: number) =>
      alongX ? add(u0, y0, v0, u1, y1, v1, PAL.metal) : add(v0, y0, u0, v1, y1, u1, PAL.metal);
    for (const v of [c - 0.17, c + 0.14]) b(a0, TY, v, a1, TY + 0.06, v + 0.03);
    for (let u = a0 + 0.1; u < a1; u += 0.3) b(u, TY, c - 0.17, u + 0.03, TY + 0.015, c + 0.17);
    for (let u = a0 + 0.6; u < a1; u += 1.5) for (const v of [c - 0.17, c + 0.15]) b(u, TY + 0.06, v, u + 0.015, H - 0.32, v + 0.015);
  };
  tray(true, 0.2, X - 0.2, 0);
  for (const x of [2.6, 9.4, 16.2]) tray(false, -hw + 0.2, hw - 0.2, x);
  // cables negros sobre la bandeja central
  add(0.2, TY + 0.015, -0.08, X - 0.2, TY + 0.05, 0.02, PAL.black2);
  // spots sobre dos rieles a lo largo del salón
  for (const z of [-1.9, 1.9]) {
    add(0.3, H - 0.06, z - 0.02, X - 0.3, H - 0.03, z + 0.02, PAL.black);
    for (let x = 1.2; x < X; x += 1.8) {
      add(x - 0.05, H - 0.2, z - 0.05, x + 0.05, H - 0.06, z + 0.05, PAL.black);
      add(x - 0.035, H - 0.205, z - 0.035, x + 0.035, H - 0.2, z + 0.035, PAL.lamp, { glow: true });
    }
  }
  return out;
}

/** Lámparas colgantes (aparte: el reflejo espejado no las lleva, su boca encendida reflejada se leía como mancha en el piso). */
function lampParts(L: OfficeLayout): THREE.BufferGeometry[] {
  return L.lamps.map(l => place(lampGeometry(ROOM.height - l.y - 7 / 16), l.x, l.y, l.z));
}

function furnitureParts(L: OfficeLayout): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const desk = deskGeometry(), chair = chairGeometry(), sofa = sofaGeometry(), arm = armchairGeometry();
  const column = columnGeometry(ROOM.height);
  let seed = 3;
  for (const p of L.props) {
    switch (p.kind) {
      case 'desk': out.push(place(desk, p.x, 0, p.z)); break;
      case 'chair': out.push(place(chair, p.x, 0, p.z, p.rot)); break;
      // el frente del mueble (+z del modelo) mira a la entrada (-x)
      case 'cabinet': out.push(place(cabinetGeometry(p.island ?? 0), p.x, 0, p.z, -Math.PI / 2)); break;
      case 'column': out.push(place(column, p.x, 0, p.z)); break;
      case 'plant': out.push(place(plantGeometry(p.size ?? 1, seed++), p.x, 0, p.z, seed)); break;
      case 'planter': out.push(place(planterGeometry(seed++), p.x, 0, p.z, seed)); break;
      case 'sofa': out.push(place(sofa, p.x, 0, p.z, p.rot)); break;
      case 'armchair': out.push(place(arm, p.x, 0, p.z, p.rot)); break;
    }
  }
  for (const g of [desk, chair, sofa, arm, column]) g.dispose();
  return out;
}

/** Piso gris pulido: los reflejos (lámparas, paredes, sombra de los muebles) van pintados en la textura. */
function floorTexture(L: OfficeLayout): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const PX = 64, X = ROOM.length, W = ROOM.width;
  const cv = document.createElement('canvas');
  cv.width = Math.round(X * PX); cv.height = Math.round(W * PX);
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  const toPx = (x: number, z: number): [number, number] => [x * PX, (z + W / 2) * PX];
  ctx.fillStyle = '#a3a8ac';
  ctx.fillRect(0, 0, cv.width, cv.height);
  // juntas de dilatación
  ctx.strokeStyle = 'rgba(40,44,48,0.18)'; ctx.lineWidth = 2;
  for (let x = 5; x < X; x += 5) { ctx.beginPath(); ctx.moveTo(x * PX, 0); ctx.lineTo(x * PX, cv.height); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(0, cv.height / 2); ctx.lineTo(cv.width, cv.height / 2); ctx.stroke();
  // reflejo del zócalo negro junto a las paredes y de la pared blanca un poco más adentro
  for (const s of [0, 1]) {
    const y0 = s ? cv.height : 0, dir = s ? -1 : 1;
    const g = ctx.createLinearGradient(0, y0, 0, y0 + dir * 1.6 * PX);
    g.addColorStop(0, 'rgba(25,27,30,0.55)'); g.addColorStop(0.35, 'rgba(25,27,30,0.12)'); g.addColorStop(0.6, 'rgba(255,255,255,0.10)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, s ? cv.height - 1.6 * PX : 0, cv.width, 1.6 * PX);
  }
  { const g = ctx.createLinearGradient(cv.width, 0, cv.width - 2 * PX, 0); g.addColorStop(0, 'rgba(25,27,30,0.6)'); g.addColorStop(1, 'rgba(25,27,30,0)'); ctx.fillStyle = g; ctx.fillRect(cv.width - 2 * PX, 0, 2 * PX, cv.height); }
  // sombra de contacto bajo islas, muebles y sillones
  ctx.filter = 'blur(10px)';
  ctx.fillStyle = 'rgba(30,32,36,0.32)';
  for (const p of L.props) {
    if (p.kind === 'chair' || p.kind === 'column') continue;
    const [px, pz] = toPx(p.x, p.z);
    ctx.fillRect(px - (p.w / 2 + 0.06) * PX, pz - (p.d / 2 + 0.06) * PX, (p.w + 0.12) * PX, (p.d + 0.12) * PX);
  }
  ctx.filter = 'none';
  // brillo suave de las lámparas en el piso pulido
  for (const l of L.lamps) {
    const [px, pz] = toPx(l.x, l.z);
    const g = ctx.createRadialGradient(px, pz, 0, px, pz, 1.1 * PX);
    g.addColorStop(0, 'rgba(255,246,226,0.30)'); g.addColorStop(1, 'rgba(255,246,226,0)');
    ctx.fillStyle = g; ctx.fillRect(px - 1.1 * PX, pz - 1.1 * PX, 2.2 * PX, 2.2 * PX);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Cuánto tapa el piso al reflejo (1 = piso mate, sin reflejo). */
const FLOOR_OPACITY = 0.72;

export interface Office { group: THREE.Group; seats: Seat[]; extraSeats: Seat[] }

/** Arma la oficina estática: 3 mallas (todo lo voxel fundido, su reflejo y el piso). Liberar con `disposeObject(group)` del kit. */
export function buildOffice(): Office {
  const L = officeLayout();
  const group = new THREE.Group();
  group.name = 'oficina';
  const parts = [...shellParts(L), ...furnitureParts(L)];
  const lamps = lampParts(L);
  const merged = mergeGeometries([...parts, ...lamps], false);
  const reflected = mergeGeometries(parts, false);
  for (const p of [...parts, ...lamps]) p.dispose();
  if (!merged || !reflected) throw new Error('buildOffice: no se pudieron fundir las geometrías');
  reflected.computeBoundingSphere();
  merged.computeBoundingSphere();
  const solid = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ vertexColors: true }));
  solid.name = 'oficina-voxel';
  solid.matrixAutoUpdate = false;
  group.add(solid);

  // Piso pulido: el salón espejado debajo del piso (la misma geometría sin las lámparas, 1 draw call más) y el piso semitransparente encima.
  // Es el reflejo de verdad según desde dónde mires, sin render extra de la escena (un Reflector la dibujaría dos veces).
  const mirror = new THREE.Mesh(reflected, new THREE.MeshBasicMaterial({ vertexColors: true }));
  mirror.name = 'oficina-reflejo';
  mirror.scale.y = -1;
  mirror.updateMatrix();
  mirror.matrixAutoUpdate = false;
  group.add(mirror);

  const tex = floorTexture(L);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM.length, ROOM.width).rotateX(-Math.PI / 2).translate(ROOM.length / 2, 0, 0),
    new THREE.MeshBasicMaterial({ ...(tex ? { map: tex } : { color: 0xa3a8ac }), transparent: true, opacity: FLOOR_OPACITY, depthWrite: true }),
  );
  floor.name = 'oficina-piso';
  floor.matrixAutoUpdate = false;
  group.add(floor);
  return { group, seats: L.seats, extraSeats: L.extraSeats };
}
