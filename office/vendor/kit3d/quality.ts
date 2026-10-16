// COPIA GENERADA por tools/vendor-kit3d.mjs desde fabrica/kit3d/src/quality.ts. No editar a mano: re-correr el script.
/** Nivel de calidad del render: 'high' = lo que pidieron las opciones; 'low' = sin sombras y pixel ratio 1. */
export type Quality = 'high' | 'low';

/** Umbral y ventana del gobernador de FPS. */
export interface FpsGovernorOptions {
  /** Si el promedio de la ventana queda por debajo de estos FPS, se pasa a 'low'. */
  low: number;
  /** Largo de la ventana en segundos (ventanas consecutivas, sin solaparse). */
  windowSec: number;
}

/** Gobernador de FPS: lo que devuelve feed(dt) en cada frame. */
export interface FpsGovernor {
  /** Suma un frame de `dt` segundos y devuelve la calidad que corresponde ahora. */
  feed(dt: number): Quality;
}

/** Un frame de más de 1 s es una pausa (pestaña oculta, depurador), no un frame lento: no cuenta. */
const MAX_FRAME_SEC = 1;

/**
 * Calidad adaptativa pura: promedia los FPS por ventanas de `windowSec` y pasa a 'low' la primera vez que una
 * ventana completa queda bajo `low`. Nunca vuelve a 'high' sola (subir y bajar sombras en loop se ve peor).
 */
export function createFpsGovernor(o: FpsGovernorOptions): FpsGovernor {
  let quality: Quality = 'high';
  let frames = 0;
  let time = 0;
  return {
    feed(dt) {
      if (quality === 'low' || !(dt > 0) || dt > MAX_FRAME_SEC) return quality;
      frames++;
      time += dt;
      if (time >= o.windowSec) {
        if (frames / time < o.low) quality = 'low';
        frames = 0;
        time = 0;
      }
      return quality;
    },
  };
}

/** Calidad que se decide durante la carrera y se aplica recién en una transición (cambiarla recompila materiales: congela). */
export interface DeferredQuality {
  /** Suma un frame al gobernador. */
  feed(dt: number): void;
  /** En una transición: la calidad a aplicar si cambió desde la última vez, o null. */
  commit(): Quality | null;
  /** true si hay un cambio esperando a la próxima transición. */
  pending(): boolean;
}

/** Envuelve un gobernador de FPS para que el cambio de calidad se aplique en la próxima transición. */
export function createDeferredQuality(gov: FpsGovernor): DeferredQuality {
  let applied: Quality = 'high';
  let wanted: Quality = 'high';
  return {
    feed(dt) { wanted = gov.feed(dt); },
    commit() {
      if (wanted === applied) return null;
      applied = wanted;
      return applied;
    },
    pending: () => wanted !== applied,
  };
}
