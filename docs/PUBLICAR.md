# Publicar una versión

Nada de esto se hace sin el OK explícito del dueño: crea el repo público y sube el instalador.

## Antes de publicar (lo verifica `npm run release`)

1. `npm test` y `npm run typecheck` en verde.
2. Compila el shell y genera el instalador NSIS (por usuario, sin admin) en `release/`.
3. Corre `check:clean` sobre `release/win-unpacked/resources` **y** sobre el contenido extraído de `app.asar`.
   Con una sola violación (ruta de usuario, email, token, archivo de configuración) aborta y sale con código distinto de 0.
4. Sin `--publish` es un **dry-run**: deja todo listo en `release/` y no sube nada.

## Primera vez: crear el repo público (requiere OK)

```
gh auth status
gh repo create virtual-ofi --public --source . --push
```

El `owner` de `electron-builder.yml` ya apunta a la cuenta de gh; el repo es el que consulta la app instalada para actualizarse.

## Publicar una versión (requiere OK)

1. Subir `version` en `package.json` (la app instalada solo se actualiza si la versión nueva es mayor).
2. Dry-run: `npm run release`
3. Publicar: `npm run release -- --publish` (crea el tag `vX.Y.Z` y el GitHub Release con el `.exe`, `latest.yml` y `.blockmap`).

La app instalada revisa al arrancar y cada 4 horas, descarga en segundo plano e instala al cerrar.
Para probar la auto-actualización: instalar 0.1.0, publicar 0.1.1 y abrir la app.

## Instalar y desinstalar

- Instalador `Oficina-virtual-Setup-<versión>.exe`: por usuario, un clic, sin pedir administrador (`oneClick`, `perMachine: false`, `allowElevation: false`).
- Desinstalar: "Aplicaciones instaladas" de Windows, o el acceso directo **Oficina virtual > Desinstalar** del menú Inicio (se crea en `build/installer.nsh`).
- El desinstalador cierra la app si está abierta (electron-builder la detecta y la termina), quita archivos, accesos directos y la entrada de arranque con Windows (`HKCU\...\Run`).
- Pregunta si borrar también los ajustes locales (clave del relay, alias, preferencias en `%APPDATA%\virtual-ofi`); la opción por defecto es **No**. En desinstalación silenciosa (`/S`) y durante una actualización nunca se borran.

### Qué se comprobó y qué no (2026-10-16)

Comprobado: el instalador compila con el script propio (`build/installer.nsh`), el `app.asar` extraído da 0 violaciones en `check:clean`, `win-unpacked` arranca y captura con sesiones reales.
**Sin comprobar en ejecución**: instalar/desinstalar de verdad (accesos directos, entrada en Aplicaciones instaladas, borrado del Run, cierre de la app abierta, la pregunta de ajustes). El entorno automático bloqueó correr el instalador en esta PC; hay que probarlo con OK del usuario (instalar a una carpeta de prueba con `/S /D=<ruta>` y desinstalar).
