# relay (Cloudflare Workers, plan gratis)

Punto comun de la oficina virtual: cada PC manda sus sesiones con `PUT /state` y todas leen el
conjunto con `GET /state`. Header `Authorization: Bearer <clave>` (secreto `RELAY_KEY` del Worker).

- `PUT /state` cuerpo `{ pc, sessions: SessionSnapshot[] }` reemplaza solo las sesiones de esa PC
  (cada sesion debe traer `pc` igual al del cuerpo; campos extra o estados raros -> 400).
- `GET /state` -> `{ sessions: SessionSnapshot[] }` con todas las PCs; lo de mas de 1 dia vence.
- Sin clave o clave mala -> 401.
- El estado vive en MEMORIA de un Durable Object (no escribe a disco/KV por latido, para cuidar el
  plan gratis). Si el DO se reinicia, se repone con el proximo latido (30 s) de cada PC.

## Tests

```
cd relay
npm install --legacy-peer-deps   # npm 8 falla sin el flag con vitest 4
npm test                         # corre el Worker local con miniflare
npm run typecheck
```

## Desplegar (lo hace el usuario, una sola vez)

1. Crear cuenta gratis en https://dash.cloudflare.com/sign-up
2. `cd relay && npm install --legacy-peer-deps`
3. `npx wrangler login` (abre el navegador)
4. `npx wrangler secret put RELAY_KEY` (pegar una clave larga y aleatoria; guardarla, va en los
   ajustes del lector de cada PC; no se commitea)
5. `npx wrangler deploy` -> imprime la URL `https://virtual-ofi-relay.<tu-subdominio>.workers.dev`
6. Probar: `curl -H "Authorization: Bearer <clave>" https://<url>/state` -> `{"sessions":[]}`

La URL puede ser publica; la clave no.
