// Cámara libre de la oficina: orbitar (botón izq / un dedo), desplazar (botón der / dos dedos / shift), zoom (rueda / pellizco),
// con límites: ni el foco ni la cámara salen del salón (ni atraviesan techo o piso).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ROOM } from './layout';

/** Vistas guardadas (posición y foco). `entrada` = como las fotos: desde la puerta mirando al fondo. */
export const CAMERA_PRESETS = {
  entrada: { pos: [0.3, 2.45, ROOM.aisleZ + 0.9], target: [ROOM.length / 2 + 2, 0.5, ROOM.aisleZ] },
  isla: { pos: [2.2, 2.6, 3.9], target: [7.5, 0.8, 0.4] },
  fondo: { pos: [ROOM.length - 0.4, 2.1, 3.9], target: [ROOM.length / 2 - 1, 0.8, -2.2] },
  alto: { pos: [0.5, 2.85, ROOM.aisleZ - 2.3], target: [ROOM.length * 0.55, 0, ROOM.aisleZ + 0.3] },
} as const satisfies Record<string, { pos: readonly number[]; target: readonly number[] }>;
export type CameraPreset = keyof typeof CAMERA_PRESETS;

export interface OfficeCamera {
  /** La cámara que hay que pasarle al renderer (agregado a la firma del plan: sin ella no hay con qué dibujar). */
  camera: THREE.PerspectiveCamera;
  /** Por frame: amortiguación de los controles y límites del salón. */
  update(dt: number): void;
  /** Salta a una vista guardada. */
  setPreset(name: CameraPreset): void;
  /** Prende/apaga los controles del mouse (el modo recorrido los apaga mientras dura; la vista queda como estaba). */
  setEnabled(on: boolean): void;
  /** Saca los listeners del canvas. */
  dispose(): void;
}

const MARGIN = 0.25;

export function createOfficeCamera(canvas: HTMLCanvasElement, opts: { preset?: CameraPreset } = {}): OfficeCamera {
  const camera = new THREE.PerspectiveCamera(55, Math.max(1e-3, canvas.clientWidth / Math.max(1, canvas.clientHeight)), 0.05, 60);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.screenSpacePanning = false;     // desplazar = moverse por el plano del piso
  controls.minDistance = 0.8;
  controls.maxDistance = 16;
  controls.minPolarAngle = 0.15;           // casi cenital como mucho
  controls.maxPolarAngle = Math.PI * 0.52; // un poco por debajo del horizonte, nunca desde abajo del piso
  controls.zoomToCursor = true;

  const lo = new THREE.Vector3(MARGIN, 0.35, -ROOM.width / 2 + MARGIN);
  const hi = new THREE.Vector3(ROOM.length - MARGIN, ROOM.height - 0.7, ROOM.width / 2 - MARGIN);
  const tLo = new THREE.Vector3(0.5, 0, -ROOM.width / 2 + 0.5);
  const tHi = new THREE.Vector3(ROOM.length - 0.5, 2.2, ROOM.width / 2 - 0.5);

  const setPreset = (name: CameraPreset) => {
    const p = CAMERA_PRESETS[name];
    camera.position.set(p.pos[0]!, p.pos[1]!, p.pos[2]!);
    controls.target.set(p.target[0]!, p.target[1]!, p.target[2]!);
    controls.update();
  };
  setPreset(opts.preset ?? 'entrada');

  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w > 0 && h > 0 && Math.abs(camera.aspect - w / h) > 1e-4) { camera.aspect = w / h; camera.updateProjectionMatrix(); }
  };

  return {
    camera,
    update(_dt) {
      resize();
      controls.update();
      // límites: el foco y la cámara se quedan adentro del salón
      controls.target.clamp(tLo, tHi);
      camera.position.clamp(lo, hi);
      camera.lookAt(controls.target);
    },
    setPreset,
    setEnabled(on) { controls.enabled = on; },
    dispose() { controls.dispose(); },
  };
}
