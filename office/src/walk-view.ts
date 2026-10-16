// Modo recorrido: la parte de three + DOM (cámara en primera persona, teclado, mouse con Pointer Lock, mira y cartel).
// La lógica (movimiento, choques, a quién apunta) es pura y vive en walk.ts.
//
// Controles: WASD/flechas caminar, mouse mirar (Pointer Lock; si el navegador no lo da, arrastrando con el botón izquierdo),
// Shift correr, Esc salir. Sin cabeceo ni inercia de cámara y campo de visión de 72° para no marear.
import * as THREE from 'three';
import type { SessionSnapshot } from '../../core/identity';
import type { Crowd } from './character';
import { poseOf } from './behavior';
import {
  EYE_HEIGHT, NO_INPUT, pickTarget, spawnAtDoor, stepPlayer, walkWorld, type PlayerState, type TargetCandidate, type WalkInput,
} from './walk';

export const WALK_FOV = 72;
const MOUSE_SENS = 0.0022;           // rad por píxel
const HELP_MS = 5000;
const SEATED_H = 1.36, STANDING_H = 1.48;   // altura de la cabeza sentado / de pie (ver character.ts)

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

  // ---------- HUD ----------
  const root = el('div', 'position:fixed;inset:0;pointer-events:none;display:none;z-index:5;font:13px/1.35 "Segoe UI",system-ui,sans-serif;color:#eef0f2', o.hudParent ?? document.body);
  root.className = 'ofi-walk';
  // mira: un punto chico con borde oscuro (se ve sobre paredes blancas y sobre el piso)
  el('div', 'position:absolute;left:50%;top:50%;width:4px;height:4px;margin:-3px 0 0 -3px;border-radius:50%;background:#fff;border:1px solid rgba(0,0,0,.55);opacity:.85', root);
  const card = el('div', 'position:absolute;left:50%;top:calc(50% + 60px);transform:translateX(-50%);background:rgba(16,18,21,.82);border-radius:6px;padding:6px 10px;white-space:nowrap;display:none;text-align:center', root);
  const help = el('div', 'position:absolute;left:50%;bottom:28px;transform:translateX(-50%);background:rgba(16,18,21,.78);border-radius:6px;padding:7px 12px;white-space:nowrap;transition:opacity .6s;color:#cfd3d7', root);

  const showHelp = () => {
    const locked = document.pointerLockElement === canvas;
    help.innerHTML = '<b style="color:#eef0f2">WASD</b> o flechas: caminar · <b style="color:#eef0f2">Mouse</b>: mirar · <b style="color:#eef0f2">Shift</b>: correr · <b style="color:#eef0f2">Esc</b>: salir'
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
    dragging = true;
    if (document.pointerLockElement !== canvas) requestLock();
  };
  const onMouseUp = () => { dragging = false; };
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
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => { /* sin Pointer Lock: queda arrastrar */ });
    } catch { /* idem */ }
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('mousedown', onMouseDown);
  document.addEventListener('pointerlockchange', onLockChange);

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
    camera.rotation.set(state.pitch, state.yaw + Math.PI, 0);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w > 0 && h > 0 && Math.abs(camera.aspect - w / h) > 1e-4) { camera.aspect = w / h; camera.updateProjectionMatrix(); }
  }

  function exit() {
    if (!active) return;
    active = false;
    keys.clear(); dragging = false; lookX = lookY = 0;
    root.style.display = 'none';
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
      placeCamera();
      target = pickTarget(state, cands)?.id ?? null;
      renderCard(target);
    },
    place(s) { state = { ...s }; placeCamera(); },
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
      root.remove();
    },
  };
}
