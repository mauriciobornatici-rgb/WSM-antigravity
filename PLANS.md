# Plan de trabajo — WSM SportsERP

Adaptado de Base Codex 2.0.0 (`template/PLANS.md`). Este es un plan de tarea;
el roadmap funcional sigue en [MASTER_PLAN](docs/execution/MASTER_PLAN.md).
Las reglas de [AGENTS.md](AGENTS.md) conservan su autoridad.

## Resultado y alcance

Analizar la app y adaptar la plantilla para mejorar continuidad y verificación.
Incluye documentación, mapa de arquitectura, riesgos y perfiles de revisión.
Las correcciones funcionales y los cambios de CI se proponen para la siguiente etapa.
No se incluyen migraciones, despliegues ni llamadas a ARCA/Tiendanube.

## Criterios observables

- [x] Comparación basada en archivos y comandos reales.
- [x] Beneficios, riesgos y prioridades documentados.
- [x] Historial anterior conservado antes de resumir el estado.
- [x] Una fuente canónica por dato y compatibilidad mediante enlaces.
- [x] Perfiles de la plantilla adaptados al ERP, sin fijar modelo ni esfuerzo.
- [x] Verificaciones ejecutadas y resultados diferenciados de límites del entorno.
- [ ] Cierre de calidad integral de la app: cobertura, E2E y RBAC pendientes.

## Hitos y evidencia

1. Diagnóstico y comparación: [informe](docs/execution/ANALISIS_APP_Y_BASE_CODEX_2026-09-06.md).
2. Adaptación documental: [mapa de incorporación](docs/development/BASE_CODEX_ADOPTION.md).
3. Entrega del análisis: [verificaciones y límites](.agents/context/AUDIT.md).

Estado: análisis entregado con hallazgos; no habilita producción.
Los cambios de aplicación quedan para una nueva decisión del usuario.

## Roles y ejecución

El coordinador aplicó criterios de arquitectura, seguridad, QA y mantenibilidad.
No se ejecutaron subagentes ni una auditoría independiente.
Los especialistas preparados se usan solo cuando lo autorizan las instrucciones
de la sesión y aportan una subtarea independiente.

## Riesgos y reversión

| Riesgo | Control | Reversión |
|---|---|---|
| Perder contexto previo | Copias verificadas antes de editar | Recuperar el archivo concreto desde el archivo histórico |
| Duplicar autoridad | Índices de compatibilidad en `.ai/` | Restituir únicamente los documentos afectados |
| Sobrecoste de agentes | Un coordinador por defecto; máximo dos especialistas simultáneos configurados | Retirar los archivos nuevos de `.codex/` |
| Confundir tests con aptitud productiva | Separar pass, fail y blocked | No avanzar a producción con gates pendientes |

No usar `git reset --hard`: existen cambios funcionales previos del usuario.

## Próximo incremento propuesto

1. Corregir y probar el guard de retiro por mostrador.
2. Acordar aislamiento de MySQL para smokes e integración.
3. Completar cobertura/E2E/CI antes de decidir refactorizaciones.
