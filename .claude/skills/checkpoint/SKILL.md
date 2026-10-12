---
name: checkpoint
description: Guarda el estado del trabajo en .agents/context/TASKS.md para retomar sin reconstruir la conversación. Úsalo en cada hito, ante un bloqueo, antes de compactar y antes de cerrar la sesión.
---

Actualizá `.agents/context/TASKS.md` para que otra sesión retome sin leer esta conversación. Escribí lo necesario para continuar, no la crónica.

**Va:** objetivo activo; criterios con `[x]` solo si hay evidencia; evidencia (comando → exit code, sin salidas largas); hechos costosos de descubrir (comprobado vs inferido); 1–3 próximas acciones ejecutables; bloqueos y aprobaciones pendientes; fecha y commits del último checkpoint.

**No va:** razonamiento, alternativas descartadas, intentos fallidos, salidas largas. Máximo ~50 líneas: el archivo se carga en cada sesión. Lo que condiciona el futuro va a `DECISIONS.md`; el detalle largo a `docs/execution/` enlazado.

Mantené coherente `docs/execution/STATE.md` (resumen del hito) si cambió el hito.

Antes de guardar, contrastá con `git status` y los archivos citados. Un checkpoint que miente es peor que ninguno.
