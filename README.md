# virtual-ofi

Oficina virtual voxel 3D: cada sesión de Claude Code (de una o varias PCs y cuentas) es un personaje cuyo estado se lee de lejos
(trabajando, esperando, libre, se fue). Solo observa; no modifica la configuración de Claude Code.

## Comandos

- `npm test` — tests (Vitest).
- `npm run typecheck` — TypeScript sin emitir.
- `npm run check:clean -- <carpeta>` — falla (código 1) si la carpeta contiene rutas de usuario, emails, tokens o archivos de configuración. Se corre antes de publicar cualquier build.

## Estructura

- `core/` — lógica pura (estados, identidad, privacidad). Sin Electron ni Three.
- `reader/` — lector local (proceso principal de Electron).
- `office/` — escena Three.js.
- `relay/` — Worker de Cloudflare (plan gratis).
- `shell/` — ventana Electron.
- `tools/` — utilidades de build (`check-clean`).

## Privacidad

De cada PC sale solo un `SessionSnapshot`: id opaco, nombre de la PC, alias de la cuenta, nombre corto del proyecto, estado y hora.
Nunca texto de conversaciones ni rutas. Claves, alias y ajustes viven en la carpeta de datos de la app, no en el repo.
