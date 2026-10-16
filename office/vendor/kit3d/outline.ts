// COPIA GENERADA por tools/vendor-kit3d.mjs desde fabrica/kit3d/src/outline.ts. No editar a mano: re-correr el script.
import * as THREE from 'three';

/** Color por defecto de los contornos: casi negro azulado, se lee sobre cualquier fondo. */
export const OUTLINE_COLOR = '#1b1b2b';

/** Nombre del atributo con la normal de contorno (promediada por posición). */
export const OUTLINE_NORMAL_ATTR = 'outlineNormal';

/**
 * Calcula una sola vez la normal de contorno: el promedio de las normales de todos los vértices que comparten
 * posición. En aristas duras (normales partidas) el casco infla en diagonal y no se abre. Llamala DESPUÉS de
 * mergeGeometries (las piezas a unir tienen que tener los mismos atributos).
 */
export function ensureOutlineNormals(geo: THREE.BufferGeometry): THREE.BufferAttribute {
  const existing = geo.getAttribute(OUTLINE_NORMAL_ATTR);
  if (existing) return existing as THREE.BufferAttribute;
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const key = (i: number) => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  const sums = new Map<string, THREE.Vector3>();
  for (let i = 0; i < pos.count; i++) {
    const k = key(i);
    let s = sums.get(k);
    if (!s) { s = new THREE.Vector3(); sums.set(k, s); }
    s.x += nor.getX(i); s.y += nor.getY(i); s.z += nor.getZ(i);
  }
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const s = sums.get(key(i))!;
    const len = s.length();
    // Suma nula (p. ej. las dos caras de un plano): se usa la normal propia.
    if (len > 1e-6) { out[i * 3] = s.x / len; out[i * 3 + 1] = s.y / len; out[i * 3 + 2] = s.z / len; }
    else { out[i * 3] = nor.getX(i); out[i * 3 + 1] = nor.getY(i); out[i * 3 + 2] = nor.getZ(i); }
  }
  const attr = new THREE.BufferAttribute(out, 3);
  geo.setAttribute(OUTLINE_NORMAL_ATTR, attr);
  return attr;
}

/** Material de contorno por "casco invertido": dibuja la cara de atrás inflada a lo largo de la normal de contorno (outlineNormal). */
export function outlineMaterial(thickness = 0.04, color: THREE.ColorRepresentation = OUTLINE_COLOR): THREE.MeshBasicMaterial {
  const t = thickness.toFixed(4);
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  m.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec3 ${OUTLINE_NORMAL_ATTR};`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n  transformed += normalize( ${OUTLINE_NORMAL_ATTR} ) * ${t};`);
  };
  m.customProgramCacheKey = () => `fab-outline-${t}`;
  return m;
}

/** Contorno para un Mesh: lo agrega como hijo con la misma geometría (no la duplica). */
export function addOutline(mesh: THREE.Mesh, thickness?: number, color?: THREE.ColorRepresentation): THREE.Mesh {
  ensureOutlineNormals(mesh.geometry);
  const o = new THREE.Mesh(mesh.geometry, outlineMaterial(thickness, color));
  o.name = 'outline';
  o.userData.sharedGeometry = true;
  mesh.add(o);
  return o;
}

/** Contorno de un InstancedMesh: la malla para agregar a la escena y sync() para copiar el count. */
export interface InstancedOutline {
  mesh: THREE.InstancedMesh;
  /** Copia el `count` del InstancedMesh original (si no, quedan contornos de instancias que ya no se dibujan). */
  sync(): void;
}

/**
 * Contorno para un InstancedMesh: comparte geometría y matrices (cero copias por frame).
 * Llamá `sync()` cada vez que cambie `inst.count`.
 */
export function outlineInstanced(inst: THREE.InstancedMesh, thickness?: number, color?: THREE.ColorRepresentation): InstancedOutline {
  ensureOutlineNormals(inst.geometry);
  const mesh = new THREE.InstancedMesh(inst.geometry, outlineMaterial(thickness, color), inst.instanceMatrix.count);
  mesh.instanceMatrix = inst.instanceMatrix;
  mesh.count = inst.count;
  mesh.frustumCulled = inst.frustumCulled;
  mesh.userData.sharedGeometry = true;
  return { mesh, sync() { mesh.count = inst.count; } };
}
