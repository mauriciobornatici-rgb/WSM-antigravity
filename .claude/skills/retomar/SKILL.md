---
name: retomar
description: Reanuda el trabajo en una sesión nueva. Reconstruye el estado desde .agents/context/, lo contrasta con la realidad del repo y reporta divergencias antes de seguir.
disable-model-invocation: true
---

Antes de tocar nada, comprobá que el registro coincide con la realidad.

1. **Registro:** `.agents/context/TASKS.md` ya está en contexto. Leé además las últimas entradas de `DECISIONS.md` y los hallazgos abiertos (`- [ ]`) de `AUDIT.md`.
2. **Realidad:** `git status`, `git log --oneline -10`. ¿Los archivos que cita TASKS existen y dicen lo que dice? ¿Los criterios marcados `[x]` tienen evidencia? Si es barato, re-corré el check (p. ej. `node scripts/qa-runner.js unit`). Últimas líneas de `.agents/context/BITACORA.md`: ¿archivos tocados que TASKS no menciona?
3. **Reportá en pocas líneas:** dónde quedó el trabajo, próxima acción, **divergencias** (lo que el registro afirma y la realidad no confirma), hallazgos abiertos.
4. Si hay divergencias, corregí TASKS.md primero. Sin divergencias ni bloqueos, seguí con la próxima acción sin pedir confirmación.
