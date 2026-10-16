// COPIA GENERADA por tools/vendor-kit3d.mjs desde fabrica/kit3d/src/dispose.ts. No editar a mano: re-correr el script.
import * as THREE from 'three';

/**
 * Libera geometrías, materiales y sus texturas (`map`) de todo un árbol.
 * No toca la geometría global de los Sprites ni la marcada con `userData.sharedGeometry`.
 * Los gradientMap toon son compartidos y no se liberan. A los InstancedMesh les llama `dispose()`: es lo único que
 * libera sus buffers de instancias en la GPU (r170).
 */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse(o => {
    if ((o as THREE.Sprite).isSprite) {
      const s = o as THREE.Sprite;
      s.material.map?.dispose();
      s.material.dispose();
      return;
    }
    // Los contornos instanciados comparten el atributo de matrices: liberarlo dos veces es inofensivo.
    if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    const m = o as THREE.Mesh;
    if (m.geometry && !o.userData.sharedGeometry) m.geometry.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      (mat as THREE.MeshBasicMaterial).map?.dispose();
      mat.dispose();
    }
  });
}
