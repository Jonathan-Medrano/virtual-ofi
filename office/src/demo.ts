// Simulador de sesiones para ver la oficina sin Claude Code: ~12 sesiones inventadas (2 cuentas, 2 PCs) que entran,
// trabajan, esperan, se levantan, se van y vuelven como sesiones nuevas. Puro y determinista (semilla fija + reloj
// inyectable), así se puede probar y reproducir. Nombres de proyecto inventados: nada del usuario.
import type { SessionSnapshot } from '../../core/identity';
import type { SessionStatus } from '../../core/state';

const PROJECTS = [
  'tienda-mate', 'bot-clima', 'landing-yerba', 'api-turnos', 'juego-ovni', 'scraper-libros',
  'panel-ventas', 'app-recetas', 'cli-notas', 'web-club', 'mapa-bici', 'quiz-rock',
] as const;
const ACCOUNTS = ['Cuenta A', 'Cuenta B'] as const;
const PCS = ['PC Casa', 'PC Trabajo'] as const;

interface Slot {
  i: number;
  gen: number;            // cuántas veces se "reabrió" (cada vez es una sesión nueva, con otro id)
  status: SessionStatus | 'absent';
  until: number;          // segundos desde el inicio del demo
  lifeEnd: number;        // cuándo se cierra esta sesión
  updatedAt: number;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DemoFeed { tick(): SessionSnapshot[] }

/**
 * `now` en milisegundos (por defecto `Date.now`). Cada `tick()` devuelve las sesiones vigentes; las que se cerraron
 * aparecen como `closed` unos segundos y después dejan de aparecer.
 */
export function createDemoFeed(now: () => number = () => Date.now(), opts: { sessions?: number; seed?: number } = {}): DemoFeed {
  const N = opts.sessions ?? 12;
  const r = rng(opts.seed ?? 20261016);
  const t0 = now();
  const between = (a: number, b: number) => a + r() * (b - a);
  const slots: Slot[] = Array.from({ length: N }, (_, i) => ({
    i, gen: 0,
    // 8 arrancan casi enseguida (para que no se vea vacío), el resto se suma de a poco
    status: 'absent', until: i < 8 ? between(0, 4) : between(8, 30),
    lifeEnd: 0, updatedAt: t0,
  }));

  function nextPhase(s: Slot, t: number) {
    if (s.status === 'absent') {
      s.status = 'working'; s.until = t + between(12, 35); s.lifeEnd = t + between(90, 260);
      return;
    }
    if (s.status === 'closed') { s.status = 'absent'; s.gen++; s.until = t + between(4, 20); return; }
    if (t >= s.lifeEnd) { s.status = 'closed'; s.until = t + 6; return; }
    if (s.status === 'working') {
      const x = r();
      s.status = x < 0.4 ? 'waiting' : x < 0.75 ? 'idle' : 'working';
      s.until = t + (s.status === 'waiting' ? between(8, 18) : s.status === 'idle' ? between(15, 30) : between(10, 25));
      return;
    }
    s.status = 'working'; s.until = t + between(12, 35);   // de esperar o pasear vuelve a trabajar
  }

  return {
    tick() {
      const ms = now();
      const t = (ms - t0) / 1000;
      const out: SessionSnapshot[] = [];
      for (const s of slots) {
        let guard = 0;
        while (t >= s.until && guard++ < 50) { nextPhase(s, s.until); s.updatedAt = t0 + s.until * 1000; }
        if (s.status === 'absent') continue;
        out.push({
          id: `demo-${s.i}-${s.gen}`,
          pc: PCS[s.i % 2]!,
          account: ACCOUNTS[Math.floor(s.i / 2) % 2]!,
          project: PROJECTS[(s.i + s.gen * 5) % PROJECTS.length]!,
          status: s.status,
          updatedAt: Math.round(s.updatedAt),
        });
      }
      return out;
    },
  };
}

/** Escena fija de `n` sesiones con estados mezclados (para capturas): mayoría trabajando, algunas esperando, algunas paseando. */
export function demoSnapshots(n: number, at = 0): SessionSnapshot[] {
  const pattern: SessionStatus[] = ['working', 'waiting', 'working', 'idle', 'working', 'working', 'waiting', 'idle'];
  return Array.from({ length: n }, (_, i) => ({
    id: `fija-${i}`,
    pc: PCS[i % 2]!,
    account: ACCOUNTS[Math.floor(i / 2) % 2]!,
    project: PROJECTS[i % PROJECTS.length]! + (i >= PROJECTS.length ? `-${Math.floor(i / PROJECTS.length) + 1}` : ''),
    status: n === 1 ? 'waiting' : pattern[i % pattern.length]!,
    updatedAt: at + i,
  }));
}
