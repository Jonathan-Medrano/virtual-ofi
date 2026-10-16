# Qué dejan los registros de Claude Code (verificado 2026-10-16)

Fuente: `~/.claude/projects/<carpeta-del-proyecto>/<sessionId>.jsonl`, un JSON por línea. Se miraron solo tipos y forma, nunca el texto.

## Tipos útiles
| Registro | Qué significa |
|---|---|
| `user` con `message.content[].type="text"` | el usuario escribió: empieza un turno → **working** |
| `assistant` con `stop_reason:"tool_use"` | Claude pidió una herramienta |
| `user` con `content[].type="tool_result"` | la herramienta terminó (o el permiso se resolvió) |
| `assistant` con `stop_reason:"end_turn"` | Claude terminó de responder: le toca al usuario |
| `system` / `turn_duration` | marca confiable de fin de turno |
| `bridge-session` | trae `ownerAccountUuid`: cuenta dueña de la sesión (sin timestamp) |
| `permission-mode`, `mode`, `last-prompt`, `ai-title`, `atis-latch`, otros | ruido de estado: se ignoran para el estado |
`attachment`, `queue-operation` traen timestamp pero no cambian el estado.

## No existe un registro de "pidió permiso"
Un permiso pendiente se ve igual que una herramienta lenta: `tool_use` sin `tool_result` posterior. Decisión: **waiting** si hay una herramienta pendiente hace ≥ 15 s; es una heurística (una herramienta larga aparece como "esperando"). Los hooks de Claude Code (evento de notificación) darían el dato exacto: queda como siguiente paso, solo si el usuario lo acepta al instalar.

## Reglas de estado (ahora = hora actual, última actividad = mayor `timestamp` del archivo)
1. Archivo sin registros útiles, o sin actividad hace ≥ closedMs (15 min) → **closed**.
2. Último registro útil es fin de turno (`end_turn` o `turn_duration`): **waiting** (le toca al usuario) durante idleMs (2 min); después **idle**.
3. Último registro útil es `tool_use` sin resultado: **working** si hace < 15 s; **waiting** si hace ≥ 15 s.
4. Último registro útil es `user` (texto o tool_result): **working** (si hace ≥ idleMs sin nada → **idle**).
5. Líneas que no parsean (p. ej. la última a medias) se descartan; tipos desconocidos se ignoran.

## Cuenta
`bridge-session.ownerAccountUuid` aparece en las sesiones locales. **Pendiente de verificar** con la otra cuenta (el usuario alterna login/logout): confirmar que cambia. Si falta, la sesión queda como "sin cuenta".

## Fixtures
`core/fixtures/*.jsonl`: sintéticos, solo estructura (sin texto, rutas ni emails).
