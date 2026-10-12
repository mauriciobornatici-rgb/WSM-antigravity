# Modelo operativo adaptado a WSM

Derivado de `Base codex/docs/OPERATING_MODEL.md` y `LARGE_PROJECTS.md`.
Es una guía de trabajo subordinada a [AGENTS.md](../../AGENTS.md);
no cambia permisos ni introduce aprobaciones adicionales.

1. Leer el contexto requerido por AGENTS y localizar los archivos relevantes.
2. Definir un resultado verificable, alcance y riesgo; usar [PLANS](../../PLANS.md)
   si el cambio atraviesa módulos. Para los casos regulados por
   [GEMINI.md](../../GEMINI.md), mantener el plan específico que allí se exige.
3. Implementar un incremento acotado y preservar el trabajo local anterior.
4. Ejecutar checks dirigidos y los gates de [QUALITY](../../.agents/context/QUALITY.md).
5. Registrar evidencia, límites y siguiente acción en [TASKS](../../.agents/context/TASKS.md).
   Registrar decisiones durables solo si condicionan trabajo futuro.

## Responsabilidades disponibles

| Rol de la plantilla | Enfoque WSM | Entrega |
|---|---|---|
| codebase_explorer | UI → API → servicio → SQL/contratos | Rutas y símbolos relevantes |
| architect | Fronteras entre ventas, stock, caja y contabilidad | Alternativa mínima, consecuencias y reversión |
| test_specialist | Idempotencia, concurrencia, rollback, RBAC, impresión | Escenarios faltantes priorizados |
| security_reviewer | Cookies, permisos, secretos, webhooks y SQL | Hallazgos con precondiciones y evidencia |
| independent_auditor | Comprobar criterios contra diff y resultados | Dictamen separado con límites explícitos |

Un coordinador es suficiente para tareas pequeñas. Las definiciones preparadas
en `.codex/agents/` no implican que deban ejecutarse todas ni que estén cargadas
en una sesión ya abierta. Su ejecución depende de la autorización y capacidades
efectivas de la sesión. Cada archivo o componente tiene un único escritor.
Los perfiles de revisión están configurados como solo lectura y no fijan modelos.

## Economía de contexto

- TASKS describe el presente; el histórico vive en documentos de ejecución.
- STATE funciona como resumen e índice de hitos.
- Registrar conclusiones y enlaces, no copiar logs completos a cada documento.
- Buscar símbolos antes de leer archivos grandes.
- Comparar duración y volumen de lectura de tareas similares antes de prometer
  un ahorro porcentual. Esta adaptación aún no mide ahorro de tiempo o tokens.

## Verificaciones con datos

`validate` no equivale a integración completa con MySQL.
La configuración de desarrollo observada apunta a una base remota.
Para tests unitarios usar variables de aislamiento de [QUALITY](../../.agents/context/QUALITY.md).
El preflight revisado usa SELECT. Los smokes que escriben requieren una base
controlada y el alcance autorizado; no arrancar el servidor como preflight
genérico, pues su arranque incluye inicialización de base y workers.
