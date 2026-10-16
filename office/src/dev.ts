// Página de desarrollo: `npx vite` y abrir /office/dev.html. Parámetros: ?cam=entrada|isla|fondo|alto  &shot (sin HUD)
// &seats (marca los 16 puestos y los lugares extra). Expone window.__ofi para las capturas (tools/shot.mjs).
import * as THREE from 'three';
import { buildOffice, createOfficeCamera, CAMERA_PRESETS, type CameraPreset } from './index';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('ofi') as HTMLCanvasElement;
const hud = document.getElementById('hud')!;
if (q.has('shot')) document.body.classList.add('shot');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.info.autoReset = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x15171a);
const t0 = performance.now();
const office = buildOffice();
const buildMs = performance.now() - t0;
scene.add(office.group);

if (q.has('seats')) {
  const mk = (color: number) => new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.1, 8).translate(0, 0.55, 0), new THREE.MeshBasicMaterial({ color }));
  for (const s of office.seats) { const m = mk(0xe8533f); m.position.set(s.position.x, 0, s.position.z); scene.add(m); }
  for (const s of office.extraSeats) { const m = mk(0x3fa7e8); m.position.set(s.position.x, 0, s.position.z); scene.add(m); }
}

const cam = q.get('cam');
const ocam = createOfficeCamera(canvas, { preset: cam && cam in CAMERA_PRESETS ? (cam as CameraPreset) : 'entrada' });

const resize = () => renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
window.addEventListener('resize', resize);
resize();

let frames = 0, acc = 0, fps = 0, last = performance.now();
const stats = { ready: false, calls: 0, triangles: 0, fps: 0, buildMs: Math.round(buildMs), seats: office.seats.length, extraSeats: office.extraSeats.length };
(window as unknown as { __ofi: typeof stats }).__ofi = stats;

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  ocam.update(dt);
  renderer.info.reset();
  renderer.render(scene, ocam.camera);
  stats.calls = renderer.info.render.calls;
  stats.triangles = renderer.info.render.triangles;
  frames++; acc += dt;
  if (acc >= 1) { fps = frames / acc; frames = 0; acc = 0; stats.fps = Math.round(fps); }
  if (!stats.ready && now - t0 > 300) stats.ready = true;
  hud.textContent = `${stats.fps} fps · ${stats.calls} draw calls · ${(stats.triangles / 1000).toFixed(0)}k tri · armado ${stats.buildMs} ms`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
