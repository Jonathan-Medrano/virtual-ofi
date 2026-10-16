// Personaje voxel de una sesión + el grupo que los maneja a todos (`createCrowd`).
//
// Rendimiento (gama baja, 30 fps): cada personaje es UNA malla (cuerpo, brazos y piernas en la misma geometría) con color
// por vértice y el sombreado horneado por cara, como el salón (MeshBasicMaterial, cero luces). Brazos y piernas se animan
// moviendo los vértices en la CPU (~250 vértices por personaje): 1 draw call por personaje en vez de 5. El globito es un
// sprite que solo existe/se dibuja mientras la sesión espera.
//
// Legibilidad: color de la remera = cuenta (paleta de 4, determinista por alias). Pose = estado: sentado tecleando
// (trabajando), sentado con el brazo en alto + globito amarillo "!" con el nombre del proyecto (espera al usuario: lo único
// que pide atención), de pie caminando por el pasillo (idle), caminando hacia la puerta (cerrada).
import * as THREE from 'three';
import type { SessionSnapshot } from '../../core/identity';
import type { SessionStatus } from '../../core/state';
import { SEAT_HEIGHT, type Seat } from './layout';
import { assignSeats, queueSpot } from './assign';
import {
  createAgent, poseOf, setAgentSeat, showsBubble, stepAgent, type Agent, type Pose,
} from './behavior';

// ---------- colores ----------

/** Remeras por cuenta: 4 colores saturados que no compiten con el amarillo del globito ni con el verde de las plantas. */
export const ACCOUNT_COLORS = [0x8d63cc, 0xc9568f, 0x3f7fd6, 0xe0604f] as const;
const SKIN = 0xe2b48c, HAIR = 0x2b2420, PANTS = 0x353a42, SHOES = 0x1b1c1f, EYES = 0x1b1c1f;
const BUBBLE = '#ffc233';

/** Índice de color de la cuenta (FNV-1a del alias). "Cuenta A" = azul y "Cuenta B" = coral (hay un test). */
export function accountColorIndex(alias: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < alias.length; i++) { h ^= alias.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) % ACCOUNT_COLORS.length;
}
export const accountColor = (alias: string): number => ACCOUNT_COLORS[accountColorIndex(alias)]!;

// ---------- geometría con "huesos" ----------

// Brillo horneado por dirección (+x -x +y -y +z -z), el mismo criterio que el salón.
const SHADE = [0.8, 0.7, 1.0, 0.5, 0.92, 0.62];

/** Partes: 0 cuerpo, 1 brazo izq. (+x), 2 brazo der. (-x), 3 pierna izq., 4 pierna der. Pivotes en hombros y caderas. */
const HIP_Y = 0.62, SHOULDER_Y = 1.06;
const PIVOT = [[0, 0, 0], [0.25, SHOULDER_Y, 0], [-0.25, SHOULDER_Y, 0], [0.095, HIP_Y, 0], [-0.095, HIP_Y, 0]] as const;

interface Rig { geo: THREE.BufferGeometry; base: Float32Array; part: Uint8Array }

function buildRig(shirt: number): Rig {
  const pos: number[] = [], col: number[] = [], part: number[] = [], idx: number[] = [];
  const box = (p: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number) => {
    const c = new THREE.Color(color);
    const faces: number[][][] = [
      [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]],
      [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
      [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]],
      [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
      [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
      [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]],
    ];
    const [px, py, pz] = PIVOT[p]!;
    faces.forEach((q, i) => {
      const k = SHADE[i]!, b = pos.length / 3;
      // guardadas relativas al pivote de la parte
      for (const v of q) { pos.push(v[0]! - px, v[1]! - py, v[2]! - pz); col.push(c.r * k, c.g * k, c.b * k); part.push(p); }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    });
  };
  // cuerpo: torso, cuello, cabeza, pelo, ojos
  box(0, -0.2, HIP_Y, -0.12, 0.2, 1.1, 0.12, shirt);
  box(0, -0.2, HIP_Y, -0.125, 0.2, HIP_Y + 0.08, 0.125, PANTS);          // cintura
  box(0, -0.16, 1.1, -0.15, 0.16, 1.42, 0.15, SKIN);                      // cabeza
  box(0, -0.17, 1.36, -0.17, 0.17, 1.48, 0.13, HAIR);                     // pelo arriba
  box(0, -0.17, 1.2, -0.17, 0.17, 1.42, -0.08, HAIR);                     // pelo atrás
  box(0, -0.1, 1.26, 0.15, -0.05, 1.31, 0.165, EYES);
  box(0, 0.05, 1.26, 0.15, 0.1, 1.31, 0.165, EYES);
  // brazos (remera arriba, mano abajo)
  for (const [p, x0, x1] of [[1, 0.2, 0.3], [2, -0.3, -0.2]] as const) {
    box(p, x0, 0.74, -0.065, x1, SHOULDER_Y + 0.03, 0.065, shirt);
    box(p, x0 + 0.005, 0.64, -0.06, x1 - 0.005, 0.74, 0.06, SKIN);
  }
  // piernas (pantalón y zapatilla)
  for (const [p, x0, x1] of [[3, 0.01, 0.18], [4, -0.18, -0.01]] as const) {
    box(p, x0, 0.08, -0.085, x1, HIP_Y, 0.085, PANTS);
    box(p, x0 - 0.005, 0, -0.09, x1 + 0.005, 0.08, 0.12, SHOES);
  }
  const geo = new THREE.BufferGeometry();
  const base = new Float32Array(pos);
  const attr = new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', attr);
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  // esfera fija que cubre cualquier pose (no se recalcula por frame)
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.8, 0.2), 1.1);
  return { geo, base, part: new Uint8Array(part) };
}

const MAT = new THREE.MeshBasicMaterial({ vertexColors: true });

// ---------- globito ----------

function bubbleTexture(project: string): { tex: THREE.CanvasTexture; aspect: number } {
  const W = 256, H = 196;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  // globo de diálogo amarillo con "!" (arriba) — se lee de lejos, de cualquier ángulo (sprite) y por encima de monitores
  const bx = W / 2, by = 56, r = 46;
  g.lineWidth = 7; g.strokeStyle = '#1b1c1f'; g.fillStyle = BUBBLE;
  g.beginPath();
  g.arc(bx, by, r, 0.62 * Math.PI, 0.38 * Math.PI);
  g.lineTo(bx, by + r + 18);
  g.closePath();
  g.fill(); g.stroke();
  g.fillStyle = '#1b1c1f';
  g.font = 'bold 72px system-ui, Segoe UI, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('!', bx, by + 3);
  // nombre del proyecto debajo (solo mientras espera: sirve para saber a quién contestar)
  const text = project.length > 16 ? project.slice(0, 15) + '…' : project;
  g.font = '700 31px system-ui, Segoe UI, sans-serif';
  const tw = Math.min(W - 8, g.measureText(text).width + 22);
  const ty = 160;
  g.fillStyle = 'rgba(20,22,26,0.9)';
  g.beginPath();
  g.roundRect(bx - tw / 2, ty - 22, tw, 44, 11);
  g.fill();
  g.fillStyle = '#ffffff';
  g.fillText(text, bx, ty + 1);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspect: W / H };
}

/** Alto del globito en pantalla (fracción aproximada de la altura de la ventana): tamaño fijo, se lee igual de lejos. */
const BUBBLE_SCREEN_H = 0.13;

// ---------- personaje ----------

export interface Character {
  mesh: THREE.Object3D;
  setStatus(s: SessionStatus): void;
  /** `others`/`self` (opcionales, los pasa `createCrowd`): para no caminar encima del de adelante. */
  update(dt: number, others?: readonly Agent[], self?: number): void;
  /** Agregado al contrato: cambia el puesto (ascenso desde la cola). Si ya estaba sentado, camina al nuevo. */
  setSeat(seat: Seat): void;
  /** Agregado al contrato: true cuando terminó de irse por la puerta; ahí hay que sacarlo de la escena y `dispose()`. */
  readonly removed: boolean;
  readonly agent: Agent;
  dispose(): void;
}

export interface CharacterOptions {
  /** Puesto inicial (si falta, un lugar de la cola hasta que llegue `setSeat`). */
  seat?: Seat;
  /** 'door' = entra caminando (por defecto); 'seat' = aparece ya en su lugar; 'lane' = ya paseando por el pasillo. */
  start?: 'seat' | 'door' | 'lane';
}

const tmpM = new THREE.Matrix4(), tmpR = new THREE.Matrix4(), tmpV = new THREE.Vector3();
const eul = new THREE.Euler();

function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function createCharacter(snap: SessionSnapshot, opts: CharacterOptions = {}): Character {
  const seed = seedOf(snap.id);
  const rig = buildRig(accountColor(snap.account));
  const body = new THREE.Mesh(rig.geo, MAT);
  body.name = 'personaje';
  const root = new THREE.Group();
  root.name = `sesion-${snap.id}`;
  root.add(body);

  const agent = createAgent(opts.seat ?? queueSpot(0), { start: opts.start ?? 'door', seed });
  let status: SessionStatus = snap.status;
  let t = (seed % 1000) / 137;          // fase propia: nadie teclea ni camina sincronizado con otro
  let heading = agent.heading;
  let bubble: THREE.Sprite | null = null;
  let bubbleTex: THREE.Texture | null = null;

  const posAttr = rig.geo.getAttribute('position') as THREE.BufferAttribute;
  const out = posAttr.array as Float32Array;
  const n = rig.part.length;
  const mats = [new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4()];

  /** Ángulos [x, z] de cada parte y altura del cuerpo para la pose actual. */
  function pose(p: Pose): { y: number; rot: Array<[number, number]> } {
    const typing = (k: number) => Math.sin(t * 15 + k * Math.PI) * 0.07;
    switch (p) {
      case 'sit-type':
        return { y: SEAT_HEIGHT + 0.04 - HIP_Y, rot: [[0, 0], [-1.25 + typing(0), 0.08], [-1.25 + typing(1), -0.08], [-Math.PI / 2, 0.04], [-Math.PI / 2, -0.04]] };
      case 'sit-wave':
        return { y: SEAT_HEIGHT + 0.04 - HIP_Y, rot: [[0, 0], [-2.95, 0.3 + Math.sin(t * 9) * 0.35], [-1.25, -0.08], [-Math.PI / 2, 0.04], [-Math.PI / 2, -0.04]] };
      case 'stand-type':
        return { y: 0, rot: [[0, 0], [-1.0 + typing(0) * 0.5, -0.25], [-1.0 + typing(1) * 0.5, 0.25], [0, 0], [0, 0]] };
      case 'stand-wave':
        return { y: 0, rot: [[0, 0], [-2.95, 0.3 + Math.sin(t * 9) * 0.35], [0.05, -0.05], [0, 0], [0, 0]] };
      case 'walk': {
        const s = Math.sin(t * 2 * Math.PI * 1.7);
        return { y: Math.abs(s) * 0.03, rot: [[0, 0], [-s * 0.5, 0.05], [s * 0.5, -0.05], [s * 0.55, 0], [-s * 0.55, 0]] };
      }
      default:
        return { y: Math.sin(t * 1.6) * 0.006, rot: [[0, 0], [0.04, 0.05], [0.04, -0.05], [0, 0], [0, 0]] };
    }
  }

  function skin(p: Pose) {
    const { y, rot } = pose(p);
    for (let k = 0; k < 5; k++) {
      const [px, py, pz] = PIVOT[k]!;
      eul.set(rot[k]![0], 0, rot[k]![1], 'ZXY');
      tmpR.makeRotationFromEuler(eul);
      mats[k]!.makeTranslation(px, py + y, pz).multiply(tmpR);
    }
    const b = rig.base;
    for (let i = 0; i < n; i++) {
      tmpV.set(b[i * 3]!, b[i * 3 + 1]!, b[i * 3 + 2]!).applyMatrix4(mats[rig.part[i]!]!);
      out[i * 3] = tmpV.x; out[i * 3 + 1] = tmpV.y; out[i * 3 + 2] = tmpV.z;
    }
    posAttr.needsUpdate = true;
  }

  function setBubble(on: boolean) {
    if (on && !bubble) {
      const { tex, aspect } = bubbleTexture(snap.project);
      bubbleTex = tex;
      bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, sizeAttenuation: false }));
      bubble.center.set(0.5, 0);
      bubble.scale.set(BUBBLE_SCREEN_H * aspect, BUBBLE_SCREEN_H, 1);
      bubble.renderOrder = 10;
      bubble.position.y = 1.55;
      root.add(bubble);
    }
    if (bubble) bubble.visible = on;
  }

  let lastPose: Pose | null = null;
  function update(dt: number, others?: readonly Agent[], self = -1) {
    stepAgent(agent, status, dt, others, self);
    t += dt;
    const p = poseOf(agent);
    // giro suave (sin saltos al doblar en las esquinas de la ruta)
    let d = agent.heading - heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    heading += d * Math.min(1, dt * 12);
    root.position.set(agent.pos.x, 0, agent.pos.z);
    root.rotation.y = heading;
    if (p !== 'stand' || lastPose !== 'stand') skin(p);   // de pie quieto casi no cambia: no se re-sube la malla
    lastPose = p;
    const wantBubble = showsBubble(agent.behavior) && agent.loc.kind === 'seat' && !agent.target;
    setBubble(wantBubble);
    if (bubble && wantBubble) bubble.position.y = (p === 'sit-wave' ? 1.45 : 1.62) + Math.sin(t * 3) * 0.03;
  }

  skin(poseOf(agent));
  return {
    mesh: root,
    setStatus(s) { status = s; },
    update,
    setSeat(seat) { setAgentSeat(agent, seat); },
    get removed() { return agent.removed; },
    agent,
    dispose() {
      rig.geo.dispose();
      if (bubble) (bubble.material as THREE.SpriteMaterial).dispose();
      bubbleTex?.dispose();
    },
  };
}

// ---------- todos los personajes ----------

export interface Crowd {
  /** Aplica una lista de sesiones (lo que devuelve el relay/lector/demo): crea, actualiza, reubica y despide personajes. */
  sync(snaps: SessionSnapshot[]): void;
  update(dt: number): void;
  readonly size: number;
  readonly characters: ReadonlyMap<string, Character>;
  dispose(): void;
}

/**
 * Maneja todos los personajes de la oficina. `start` define cómo aparecen las sesiones nuevas (por defecto entran por la
 * puerta; 'settled' los pone directo en su lugar, para capturas). Una sesión que desaparece de la lista se trata como
 * `closed` (se va caminando). Una sesión `closed` que todavía no tenía personaje no se crea.
 */
export function createCrowd(parent: THREE.Object3D, seats: Seat[], extraSeats: Seat[], opts: { start?: 'door' | 'settled' } = {}): Crowd {
  const chars = new Map<string, Character>();
  let assigned = new Map<string, Seat>();
  return {
    sync(snaps) {
      assigned = assignSeats(snaps, seats, extraSeats, assigned);
      const present = new Set<string>();
      for (const s of snaps) {
        present.add(s.id);
        let c = chars.get(s.id);
        const seat = assigned.get(s.id);
        if (!c) {
          if (s.status === 'closed' || !seat) continue;
          const start = opts.start === 'settled' ? (s.status === 'idle' ? 'lane' : 'seat') : 'door';
          c = createCharacter(s, { seat, start });
          chars.set(s.id, c);
          parent.add(c.mesh);
        }
        c.setStatus(s.status);
        if (seat) c.setSeat(seat);
      }
      for (const [id, c] of chars) if (!present.has(id)) c.setStatus('closed');
    },
    update(dt) {
      const list = [...chars.values()];
      const agents = list.map(c => c.agent);
      list.forEach((c, i) => c.update(dt, agents, i));
      for (const [id, c] of chars) {
        if (c.removed) { parent.remove(c.mesh); c.dispose(); chars.delete(id); }
      }
    },
    get size() { return chars.size; },
    characters: chars,
    dispose() {
      for (const c of chars.values()) { parent.remove(c.mesh); c.dispose(); }
      chars.clear();
    },
  };
}
