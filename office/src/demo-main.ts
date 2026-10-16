// Página del modo demo: oficina + personajes + sesiones simuladas en vivo.
// `npx vite` y abrir /office/dev-demo.html. Parámetros:
//   ?n=8         escena fija de n sesiones (sin n: simulador en vivo de 12 sesiones que cambian solas)
//   &settled     las sesiones aparecen directo en su lugar (si no, entran por la puerta)
//   &cam=entrada|isla|fondo|alto   &shot (sin HUD)
//   &walk        arranca en el modo recorrido (primera persona; botón "Recorrer" para volver a entrar, Esc para salir)
// Expone window.__ofi (ready, calls, triangles, fps, personajes, walk) para las capturas y window.__walk (el modo recorrido).
import * as THREE from 'three';
import { buildOffice, createOfficeCamera, CAMERA_PRESETS, type CameraPreset } from './index';
import { createCrowd, ACCOUNT_COLORS, accountColorIndex } from './character';
import { createDemoFeed, demoSnapshots } from './demo';
import { createWalkView } from './walk-view';
import { statusEs } from '../../shell/renderer/panel';
import type { SessionSnapshot } from '../../core/identity';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('ofi') as HTMLCanvasElement;
const hud = document.getElementById('hud')!;
const legend = document.getElementById('leyenda')!;
if (q.has('shot')) document.body.classList.add('shot');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.info.autoReset = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x15171a);
const office = buildOffice();
scene.add(office.group);

const fixed = q.get('n');
const crowd = createCrowd(scene, office.seats, office.extraSeats, { start: q.has('settled') ? 'settled' : 'door' });
const feed = fixed === null ? createDemoFeed() : null;
const fixedSnaps = fixed === null ? null : demoSnapshots(Math.max(0, Number(fixed) || 0));
let snaps: SessionSnapshot[] = fixedSnaps ?? feed!.tick();
crowd.sync(snaps);

const cam = q.get('cam');
const ocam = createOfficeCamera(canvas, { preset: cam && cam in CAMERA_PRESETS ? (cam as CameraPreset) : 'alto' });

const walkBtn = document.getElementById('recorrer')!;
const walk = createWalkView({
  canvas,
  crowd: () => crowd,
  sessionOf: id => snaps.find(s => s.id === id),
  statusText: statusEs,
  onExit: () => { ocam.setEnabled(true); document.body.classList.remove('walking'); },
});
function enterWalk() { ocam.setEnabled(false); document.body.classList.add('walking'); walk.enter(); }
walkBtn.addEventListener('click', enterWalk);
(window as unknown as { __walk: typeof walk }).__walk = walk;
if (q.has('walk')) enterWalk();

const resize = () => renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
window.addEventListener('resize', resize);
resize();

// Leyenda: color por cuenta y qué significa cada pose (texto corto, rioplatense).
const esc = (t: string) => t.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
function renderLegend() {
  const accounts = [...new Set(snaps.map(s => s.account))].sort();
  const sw = (c: number) => `<i style="background:#${c.toString(16).padStart(6, '0')}"></i>`;
  const counts = { working: 0, waiting: 0, idle: 0 } as Record<string, number>;
  for (const s of snaps) if (s.status in counts) counts[s.status]!++;
  legend.innerHTML =
    accounts.map(a => `<span>${sw(ACCOUNT_COLORS[accountColorIndex(a)]!)}${esc(a)}</span>`).join('') +
    `<span class="sep"></span><span>${counts.working} trabajando</span>` +
    `<span><b class="bang">!</b>${counts.waiting} ${counts.waiting === 1 ? "espera" : "esperan"} tu respuesta</span>` +
    `<span>${counts.idle} paseando</span>`;
}
renderLegend();

let frames = 0, acc = 0, last = performance.now(), feedAcc = 0;
const t0 = performance.now();
const stats = {
  ready: false, calls: 0, triangles: 0, fps: 0, personajes: 0, sesiones: snaps.length,
  walk: null as null | { x: number; z: number; yaw: number; pitch: number; target: string | null },
};
(window as unknown as { __ofi: typeof stats }).__ofi = stats;

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (feed) {
    feedAcc += dt;
    if (feedAcc >= 1) { feedAcc = 0; snaps = feed.tick(); crowd.sync(snaps); renderLegend(); }
  }
  crowd.update(dt);
  if (walk.active) walk.update(dt); else ocam.update(dt);
  renderer.info.reset();
  renderer.render(scene, walk.active ? walk.camera : ocam.camera);
  stats.walk = walk.active && walk.state ? { ...walk.state, target: walk.target } : null;
  stats.calls = renderer.info.render.calls;
  stats.triangles = renderer.info.render.triangles;
  stats.personajes = crowd.size;
  stats.sesiones = snaps.length;
  frames++; acc += dt;
  if (acc >= 1) { stats.fps = Math.round(frames / acc); frames = 0; acc = 0; }
  if (!stats.ready && now - t0 > 300) stats.ready = true;
  hud.textContent = `${stats.fps} fps · ${stats.calls} draw calls · ${(stats.triangles / 1000).toFixed(0)}k tri · ${stats.personajes} personajes`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
