// Modo recorrido: la parte de three + DOM (cámara en primera persona, teclado, mouse con Pointer Lock, mira y cartel).
// La lógica (movimiento, choques, a quién apunta) es pura y vive en walk.ts.
//
// Controles: WASD/flechas caminar, mouse mirar (Pointer Lock; si el navegador no lo da, arrastrando con el botón izquierdo),
// Shift correr, Esc salir, clic golpear (con el mouse capturado; sin captura: clic sin arrastrar). Sin cabeceo ni inercia de
// cámara y campo de visión de 72° para no marear. El golpe es solo visual y local (ver punch.ts): no toca agentes ni sesiones.
import * as THREE from 'three';
import type { SessionSnapshot } from '../../core/identity';
import type { Crowd } from './character';
import { poseOf } from './behavior';
import {
  pickPunchTarget, punchExtension, reactionPose, startReaction, stepPunch, stepReaction, tryPunch, PUNCH_IDLE,
  type PunchState, type Reaction,
} from './punch';
import {
  EYE_HEIGHT, NO_INPUT, pickTarget, spawnAtDoor, stepPlayer, walkWorld, type PlayerState, type TargetCandidate, type WalkInput,
} from './walk';

export const WALK_FOV = 72;
const MOUSE_SENS = 0.0022;           // rad por píxel
const HELP_MS = 5000;
const SEATED_H = 1.36, STANDING_H = 1.48;   // altura de la cabeza sentado / de pie (ver character.ts)
const SHAKE_TIME = 0.18;
const DRAG_PX = 5;                   // sin Pointer Lock: más que esto es mirar arrastrando, no golpe

/** Brazo voxel en primera persona: puño (piel) adelante y manga detrás; en espacio de la cámara (-z = adelante). */
function fistMesh(): THREE.Mesh {
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const SH = [0.8, 0.7, 1.0, 0.5, 0.92, 0.62];
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number) => {
    const c = new THREE.Color(color);
    const faces = [
      [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
      [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
      [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]],
    ];
    faces.forEach((q, i) => {
      const b = pos.length / 3;
      for (const v of q) { pos.push(v[0]!, v[1]!, v[2]!); col.push(c.r * SH[i]!, c.g * SH[i]!, c.b * SH[i]!); }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    });
  };
  // orden de dibujo = orden acá (sin test de profundidad): primero lo de adelante, la manga encima
  box(-0.055, -0.05, -0.12, 0.055, 0.05, 0, 0xe2b48c);           // puño
  box(-0.03, 0.02, -0.125, 0.035, 0.045, -0.115, 0xc99a74);      // nudillos
  box(-0.06, -0.06, 0, 0.06, 0.06, 0.3, 0x4a5058);               // manga
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, depthTest: false, depthWrite: false }));
  m.renderOrder = 1000;
  m.frustumCulled = false;
  m.name = 'puño';
  return m;
}
const FIST_REST = new THREE.Vector3(0.26, -0.27, -0.42);
const FIST_HIT = new THREE.Vector3(0.1, -0.12, -0.78);

/** Globito "¡auch!" (textura de canvas, se crea una vez). */
function ouchSprite(): THREE.Sprite | null {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 64;
  const g = cv.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#ffffff'; g.strokeStyle = '#1b1c1f'; g.lineWidth = 5;
  g.beginPath(); g.roundRect(4, 4, 120, 50, 14); g.fill(); g.stroke();
  g.fillStyle = '#e0604f'; g.font = 'bold 30px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('¡auch!', 64, 30);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, sizeAttenuation: false }));
  sp.scale.set(0.14, 0.07, 1);   // tamaño fijo en pantalla (de cerca no tapa todo)
  sp.renderOrder = 11;
  sp.name = 'auch';
  return sp;
}

export interface WalkViewOptions {
  canvas: HTMLCanvasElement;
  /** Los personajes (se leen en cada frame: pueden aparecer e irse). */
  crowd: () => Crowd | null;
  /** Datos de la sesión de un personaje, para el cartel. */
  sessionOf: (id: string) => SessionSnapshot | undefined;
  /** Estado en español (el mismo mapeo del panel de sesiones). */
  statusText: (status: string) => string;
  /** Al salir (Esc o al perder el Pointer Lock). */
  onExit?: () => void;
  /** Dónde se cuelga el HUD (mira, cartel, ayuda). Por defecto `document.body`. */
  hudParent?: HTMLElement;
  /** La escena: ahí se cuelga la cámara para que se dibuje el puño en primera persona. */
  scene?: THREE.Object3D;
}

export interface WalkView {
  readonly camera: THREE.PerspectiveCamera;
  readonly active: boolean;
  readonly state: PlayerState | null;
  /** id de la sesión a la que apunta la mira (null = nadie). */
  readonly target: string | null;
  enter(): void;
  exit(): void;
  /** Por frame, solo mientras está activo. */
  update(dt: number): void;
  /** Para pruebas y capturas: pone al jugador en un lugar. */
  place(s: PlayerState): void;
  /** Tira un golpe (lo mismo que el clic). Devuelve el id del golpeado, null si no le dio a nadie, o false si está en espera. */
  punch(): string | null | false;
  dispose(): void;
}

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [1, 0], ArrowUp: [1, 0], KeyS: [-1, 0], ArrowDown: [-1, 0],
  KeyD: [0, 1], ArrowRight: [0, 1], KeyA: [0, -1], ArrowLeft: [0, -1],
};

function el(tag: string, css: string, parent: HTMLElement): HTMLElement {
  const e = document.createElement(tag);
  e.style.cssText = css;
  parent.append(e);
  return e;
}

export function createWalkView(o: WalkViewOptions): WalkView {
  const { canvas } = o;
  const camera = new THREE.PerspectiveCamera(WALK_FOV, 1, 0.05, 60);
  camera.rotation.order = 'YXZ';
  const world = walkWorld();
  const people: Array<{ x: number; z: number }> = [];
  world.people = people;

  let active = false;
  let state: PlayerState | null = null;
  let target: string | null = null;
  let cardKey = '';
  let hadLock = false;
  let dragging = false;
  let lookX = 0, lookY = 0;
  let helpTimer: ReturnType<typeof setTimeout> | null = null;
  const keys = new Set<string>();
  let punchState: PunchState = PUNCH_IDLE;
  let shake = 0;
  const reactions = new Map<string, Reaction>();
  let downLocked = false, downX = 0, downY = 0, lockFailed = false;
  const fist = fistMesh();
  fist.visible = false;
  camera.add(fist);
  o.scene?.add(camera);
  const ouch = ouchSprite();

  // ---------- HUD ----------
  const root = el('div', 'position:fixed;inset:0;pointer-events:none;display:none;z-index:5;font:13px/1.35 "Segoe UI",system-ui,sans-serif;color:#eef0f2', o.hudParent ?? document.body);
  root.className = 'ofi-walk';
  // mira: un punto chico con borde oscuro (se ve sobre paredes blancas y sobre el piso)
  el('div', 'position:absolute;left:50%;top:50%;width:4px;height:4px;margin:-3px 0 0 -3px;border-radius:50%;background:#fff;border:1px solid rgba(0,0,0,.55);opacity:.85', root);
  const card = el('div', 'position:absolute;left:50%;top:calc(50% + 60px);transform:translateX(-50%);background:rgba(16,18,21,.82);border-radius:6px;padding:6px 10px;white-space:nowrap;display:none;text-align:center', root);
  const help = el('div', 'position:absolute;left:50%;bottom:28px;transform:translateX(-50%);background:rgba(16,18,21,.78);border-radius:6px;padding:7px 12px;white-space:nowrap;transition:opacity .6s;color:#cfd3d7', root);

  const showHelp = () => {
    const locked = document.pointerLockElement === canvas;
    help.innerHTML = '<b style="color:#eef0f2">WASD</b> o flechas: caminar · <b style="color:#eef0f2">Mouse</b>: mirar · <b style="color:#eef0f2">Shift</b>: correr · <b style="color:#eef0f2">Clic</b>: golpe · <b style="color:#eef0f2">Esc</b>: salir'
      + (locked ? '' : '<br><span style="opacity:.8">Hacé clic en la oficina para mirar con el mouse (o arrastrá)</span>');
    help.style.opacity = '1';
    if (helpTimer) clearTimeout(helpTimer);
    helpTimer = setTimeout(() => { help.style.opacity = '0'; }, HELP_MS);
  };

  const esc = (t: string) => t.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
  function renderCard(id: string | null) {
    const s = id ? o.sessionOf(id) : undefined;
    const key = s ? `${s.id}|${s.project}|${s.account}|${s.pc}|${s.status}` : '';
    if (key === cardKey) return;
    cardKey = key;
    if (!s) { card.style.display = 'none'; return; }
    const waiting = s.status === 'waiting';
    card.innerHTML = `<div style="font-weight:600;font-size:14px">${esc(s.project)}</div>`
      + `<div style="color:#b9bfc5">${esc(s.account)} · ${esc(s.pc)} · <span style="color:${waiting ? '#ffc233' : '#cfd3d7'};font-weight:${waiting ? 600 : 400}">${esc(o.statusText(s.status))}</span></div>`;
    card.style.display = 'block';
  }

  // ---------- entradas ----------
  const typing = (e: Event) => {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (!active || typing(e)) return;
    if (e.code === 'Escape') { exit(); return; }
    if (e.code in MOVE_KEYS || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      keys.add(e.code);
      e.preventDefault();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => { keys.delete(e.code); };
  const onBlur = () => { keys.clear(); dragging = false; };
  const onMouseMove = (e: MouseEvent) => {
    if (!active) return;
    if (document.pointerLockElement === canvas || dragging) { lookX += e.movementX; lookY += e.movementY; }
  };
  const onMouseDown = (e: MouseEvent) => {
    if (!active || e.button !== 0) return;
    downLocked = document.pointerLockElement === canvas;
    downX = e.clientX; downY = e.clientY;
    if (downLocked) { punch(); return; }     // con el mouse capturado, clic = golpe
    dragging = true;
    requestLock();                           // este clic solo captura el mouse: no golpea
  };
  const onMouseUp = (e: MouseEvent) => {
    const wasDrag = Math.hypot(e.clientX - downX, e.clientY - downY) > DRAG_PX;
    // sin Pointer Lock disponible: un clic sin arrastrar golpea
    if (active && dragging && !downLocked && lockFailed && !wasDrag && document.pointerLockElement !== canvas) punch();
    dragging = false;
  };
  const onLockError = () => { lockFailed = true; };
  const onLockChange = () => {
    const locked = document.pointerLockElement === canvas;
    if (locked) { hadLock = true; showHelp(); return; }
    // Esc con el mouse capturado: el navegador suelta el puntero sin mandar la tecla → salir
    if (hadLock && active) exit();
    hadLock = false;
  };
  function requestLock() {
    try {
      const r = canvas.requestPointerLock() as unknown;
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => { lockFailed = true; });
    } catch { lockFailed = true; }
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('mousedown', onMouseDown);
  document.addEventListener('pointerlockchange', onLockChange);
  document.addEventListener('pointerlockerror', onLockError);

  function candidates(): Array<{ id: string; x: number; z: number; seated: boolean }> {
    const out: Array<{ id: string; x: number; z: number; seated: boolean }> = [];
    const crowd = o.crowd();
    if (crowd) for (const [id, c] of crowd.characters) {
      if (c.removed) continue;
      const p = poseOf(c.agent);
      out.push({ id, x: c.agent.pos.x, z: c.agent.pos.z, seated: p === 'sit-type' || p === 'sit-wave' });
    }
    return out;
  }

  function punch(): string | null | false {
    if (!active || !state) return false;
    const r = tryPunch(punchState);
    if (!r.fired) return false;
    punchState = r.state;
    const hit = pickPunchTarget(state, candidates());
    if (!hit) return null;
    reactions.set(hit.id, startReaction(hit.id, hit.seated, state, hit));
    shake = SHAKE_TIME;
    if (ouch) { ouch.removeFromParent(); o.crowd()?.characters.get(hit.id)?.mesh.add(ouch); ouch.visible = true; }
    return hit.id;
  }

  /** Aplica las reacciones encima de lo que dibujó el personaje este frame (no toca su agente). */
  function applyReactions(dt: number) {
    const crowd = o.crowd();
    for (const [id, r0] of reactions) {
      const c = crowd?.characters.get(id);
      const body = c?.mesh.getObjectByName('personaje');
      const r = stepReaction(r0, dt);
      if (!c || !body || c.removed || !r) {
        if (body) body.rotation.set(0, 0, 0);
        if (ouch && c && ouch.parent === c.mesh) { ouch.visible = false; ouch.removeFromParent(); }
        reactions.delete(id);
        continue;
      }
      reactions.set(id, r);
      const p = reactionPose(r, c.agent.pos, world);
      c.mesh.position.x += p.dx; c.mesh.position.z += p.dz; c.mesh.position.y += p.lift;
      body.rotation.set(0, 0, p.wobble);
      if (ouch && ouch.parent === c.mesh) ouch.position.set(0, (r.kind === 'flinch' ? 1.5 : 1.75) + r.t * 0.15, 0);
    }
  }

  function input(): WalkInput {
    let f = 0, s = 0;
    for (const k of keys) { const m = MOVE_KEYS[k]; if (m) { f += m[0]; s += m[1]; } }
    const inp: WalkInput = {
      ...NO_INPUT, forward: Math.sign(f), strafe: Math.sign(s), run: keys.has('ShiftLeft') || keys.has('ShiftRight'),
      lookYaw: -lookX * MOUSE_SENS, lookPitch: -lookY * MOUSE_SENS,
    };
    lookX = 0; lookY = 0;
    return inp;
  }

  function placeCamera() {
    if (!state) return;
    camera.position.set(state.x, EYE_HEIGHT, state.z);
    const k = shake > 0 ? shake / SHAKE_TIME : 0;
    const t = performance.now() / 1000;
    camera.rotation.set(state.pitch + Math.sin(t * 90) * 0.012 * k, state.yaw + Math.PI + Math.sin(t * 70) * 0.01 * k, Math.sin(t * 60) * 0.015 * k);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w > 0 && h > 0 && Math.abs(camera.aspect - w / h) > 1e-4) { camera.aspect = w / h; camera.updateProjectionMatrix(); }
  }

  function exit() {
    if (!active) return;
    active = false;
    keys.clear(); dragging = false; lookX = lookY = 0;
    root.style.display = 'none';
    fist.visible = false;
    if (document.pointerLockElement === canvas) { hadLock = false; document.exitPointerLock(); }
    o.onExit?.();
  }

  return {
    camera,
    get active() { return active; },
    get state() { return state; },
    get target() { return target; },
    enter() {
      if (active) return;
      active = true;
      if (!state) state = spawnAtDoor(world);
      root.style.display = 'block';
      fist.visible = true;
      cardKey = '#';
      renderCard(null);
      requestLock();
      showHelp();
      placeCamera();
    },
    exit,
    update(dt) {
      if (!active || !state) return;
      const crowd = o.crowd();
      people.length = 0;
      const cands: TargetCandidate[] = [];
      if (crowd) for (const [id, c] of crowd.characters) {
        if (c.removed) continue;
        const a = c.agent;
        const seated = a.loc.kind === 'seat' && !a.target;
        if (seated) people.push({ x: a.pos.x, z: a.pos.z });
        const p = poseOf(a);
        cands.push({ id, x: a.pos.x, z: a.pos.z, h: p === 'sit-type' || p === 'sit-wave' ? SEATED_H : STANDING_H });
      }
      state = stepPlayer(state, input(), dt, world);
      punchState = stepPunch(punchState, dt);
      shake = Math.max(0, shake - dt);
      placeCamera();
      const ext = punchExtension(punchState);
      fist.position.lerpVectors(FIST_REST, FIST_HIT, ext);
      fist.rotation.set(0.08, 0.18 * (1 - ext), 0);
      applyReactions(dt);
      target = pickTarget(state, cands)?.id ?? null;
      renderCard(target);
    },
    place(s) { state = { ...s }; placeCamera(); },
    punch,
    dispose() {
      exit();
      if (helpTimer) clearTimeout(helpTimer);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('pointerlockerror', onLockError);
      camera.removeFromParent();
      fist.geometry.dispose(); (fist.material as THREE.Material).dispose();
      if (ouch) { ouch.removeFromParent(); ouch.material.map?.dispose(); ouch.material.dispose(); }
      root.remove();
    },
  };
}
