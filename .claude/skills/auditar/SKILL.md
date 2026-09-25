---
name: auditar
description: Despacha una auditoría independiente del trabajo hecho (auditor-externo, más revisor-seguridad / guardian-integridad / revisor-ux según lo que toque el cambio) y procesa los hallazgos.
argument-hint: [alcance, ej: "diff contra main" o "commits de hoy"]
disable-model-invocation: true
---

Alcance: $ARGUMENTS

1. **Preparar:** TASKS.md al día (los criterios vigentes son el contrato). Determiná el alcance exacto (rama base, rango de commits o árbol de trabajo).
2. **Despachar en paralelo**, pasando solo el alcance — **nunca** tu razonamiento ni un resumen de lo que hiciste:
   - siempre `auditor-externo`;
   - `revisor-seguridad` si toca auth, RBAC, endpoints, uploads, webhooks, config o despliegue;
   - `guardian-integridad` si toca stock, dinero, numeración, facturación, contabilidad o migraciones;
   - `revisor-ux` si toca pantallas o flujos de `packages/client`.
3. **Verificar antes de aceptar:** cada hallazgo bloqueante o importante se comprueba en el código antes de actuar. Los auditores también se equivocan.
4. **Archivar** el informe tal cual al final de `.agents/context/AUDIT.md`. Para cada hallazgo: **corregir** (y re-verificar ese punto), **aceptar** (motivo en `DECISIONS.md`, no se borra) o **descartar** (con evidencia). `- [x]` solo lo resuelto. Un bloqueante abierto impide cerrar.
5. No persigas todo: corregí lo que afecta corrección, seguridad, invariantes o un criterio declarado.
6. **Informar al usuario:** veredicto, hallazgos por severidad, corregidos / aceptados / abiertos.
