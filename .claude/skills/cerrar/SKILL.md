---
name: cerrar
description: Puerta de cierre de una tarea o entrega. Verifica criterios y DoD, corre la batería completa, exige auditoría independiente y produce el informe final.
disable-model-invocation: true
---

No se pasa por simpatía: cada punto se comprueba o se declara incumplido.

1. **Contrato:** `.agents/context/PROJECT.md` (DoD) y `TASKS.md` (criterios). Criterio sin evidencia = no verificado.
2. **Verificación completa:** `verificador` con `npm run validate` (+ `npm run test:coverage` y `qa:*` con MySQL QA si aplica). Lo que no se pudo correr queda como cobertura faltante.
3. **Auditoría:** `/auditar` sobre el alcance completo. Bloqueante abierto = no se cierra.
4. **Higiene:** bitácora vs alcance; TODOs nuevos, `console.log` de depuración, tests `.skip`, credenciales, dependencias sin uso; `npm run build:common` si cambió `@wsm/common`.
5. **Informe:** qué cambió · criterios (estado + evidencia) · verificaciones (comando → resultado) · auditoría (veredicto, corregidos/aceptados/abiertos) · riesgo residual · sin cobertura · requiere criterio humano · próximo paso.
6. **Checkpoint final** en TASKS.md y STATE.md. Nada se presenta como completo si su verificación se saltó o falló.
