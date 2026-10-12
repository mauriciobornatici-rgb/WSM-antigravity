# Riesgos activos — WSM SportsERP

Adaptado de Base Codex `template/.ai/RISKS.md`. Revisión: 2026-09-06.
Bajo: local/reversible. Medio: varios módulos o evidencia incompleta.
Alto: datos, dinero, permisos, concurrencia o salida a producción.

| ID | Nivel | Riesgo y evidencia | Mitigación / seguimiento | Responsable propuesto | Estado |
|---|---|---|---|---|---|
| R-01 | Alto | Retiro mostrador: guardas y respuesta transaccional corregidas | 17 tests dirigidos; pendiente circuito real concurrente | Desarrollo ventas | Mitigado |
| R-02 | Alto | Cobertura81,23/88,82/73,98 %; gate90 falla | Ampliar escenarios por dominio; CI conserva bloqueo | Desarrollo + QA | Abierto |
| R-03 | Alto | Los comandos operativos directos aún usan su entorno configurado | validate/test:server/test:coverage aislados por defecto; usar qa:* para smokes locales | Responsable técnico | Mitigado en QA |
| R-04 | Medio | CI con cobertura/E2E/MySQL incorporado; no ejecutado remotamente | Comprobar workflow antes de integrar; cobertura sigue roja | QA/CI | Implementado localmente |
| R-05 | Bajo | Backend JavaScript sin tipado estático | ESLint en `validate` y CI (2026-10-12); cobertura 99/92/99 %; JSDoc/checkJs por dominio si hace falta | Desarrollo backend | Mitigado |
| R-06 | Medio | Servicios/pantallas extensos; rendimiento de usuarios sin medir | Build normal inicial492,33kB; la cifra anterior incluía entorno development | Arquitectura/frontend | Abierto |
| R-07 | Medio | Entorno local habilitado: Chromium y MySQL8.0.46 | E2E2/2, RBAC12/12, bootstrap42 migraciones; no cubre hardware ni E2E completo | QA | Desbloqueado |
| R-08 | Medio | Memorias duplicadas y estado de 89 KB | Archivo histórico, estado breve y referencias canónicas | Coordinador | Mitigado documentalmente |
| R-09 | Bajo | Subagentes innecesarios elevan coste y pueden compartir sesgos | Un coordinador por defecto; delegación acotada/autorizada | Coordinador | Control previsto |
| R-10 | Alto | Homologación, backups restaurables y operación staging no demostrados aquí | Mantener gates de readiness y evidencias separadas | Operación + usuario | Pendiente |

Los responsables son roles propuestos, no asignaciones acordadas con personas.
Una entrega de diagnóstico no implica aceptación del riesgo ni autorización
para producción. Ver [AUDIT](AUDIT.md) y [readiness](../../docs/execution/PRODUCTION_READINESS_2026-08-20.md).

R-11: El adaptador de SQL legacy requiere mantenimiento; conserva hashes y reconoce
formas acotadas. No ampliar excepciones ni desactivar el modo SQL estricto sin revisión.
