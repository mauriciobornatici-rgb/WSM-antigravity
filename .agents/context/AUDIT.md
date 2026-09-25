# Evidencia de revisión — WSM SportsERP

## Actualización: correcciones autorizadas y QA local

2026-09-06. Implementación por dos Luna max; lectura, planificación, revisión y
verificación por el coordinador. Se dio feedback y se revisaron las correcciones.
No hubo un subagente revisor. El diagnóstico inicial conservado debajo es histórico.

| Comprobación final | Resultado |
|---|---|
| npm run validate | exit0: 7 guards,431 backend,62 cliente; lint sin warnings, tipos/build correctos |
| npm run test:coverage | exit1: 81,23/88,82/73,98 %, con431 tests aprobados; gate90 conservado |
| Bootstrap MySQL8.0.46 limpio/repetido | exit0,42 migraciones y4 usuarios; reanudación también comprobada |
| qa:preflight:integrity | exit0,40 relaciones, sin huérfanos/duplicados reportados |
| qa:smoke:rbac | exit0,12/12 HTTP sobre aplicación efímera y MySQL QA |
| qa:smoke:integrity | exit0,4/4 básicos;3 circuitos opcionales omitidos |
| Playwright Chromium | exit0,2/2 login con API simulada |
| Numeración y catálogo MySQL | Valores consecutivos y agrupación/hash coherentes; datos ficticios con rollback |

H-01 corregido con17 tests dirigidos; H-06 mitigado por wrappers/QA. H-03 implementado
en workflow, todavía sin ejecución remota. H-02 sigue abierto: no todos los gates
están verdes. Se corrigieron también compatibilidades de migraciones y pruebas
dependientes del entorno. Los42 SQL históricos conservaron sus hashes.

El build normal final tiene chunk inicial492,33kB (149,94kB gzip). La medición
anterior721,76kB provenía de validate con NODE_ENV=development global: no se presenta
esta diferencia como una optimización de rendimiento de la aplicación.

La revisión automática exigió permiso explícito para migrar. El usuario lo concedió
solo para wsm_qa en127.0.0.1:33308. No se ejecutaron mutaciones en base remota.

Logs: logs/qa-hardening-2026-09-06/. [Informe completo](../../docs/execution/MEJORAS_QA_2026-09-06.md).

## Diagnóstico inicial (antes de las correcciones)

Fecha: 2026-09-06. Adaptado de Base Codex `template/.ai/AUDIT.md`.

## Alcance

Análisis estructural y revisión selectiva de código; adaptación documental y
perfiles de revisión. Se preservaron los cambios funcionales previos.
Coordinador: Codex, aplicando criterios de arquitectura, QA, seguridad y mantenimiento.
Auditoría independiente: `not_run`. No se ejecutaron subagentes.

## Verificaciones

Entorno: Windows/PowerShell, Node v24.15.0, npm 11.12.1 instalados.
El CI declara Node 20; esta revisión no reproduce ese runtime.

| Verificación | Resultado | Evidencia / límite |
|---|---|---|
| npm run typecheck | pass, exit 0 | common + cliente |
| npm run validate | pass, exit 0 | Aislado de MySQL remoto; 392 backend + 61 cliente (16 archivos) |
| ESLint dentro de validate | pass con warning | POS.tsx:246, dependencia loadData en useEffect |
| Build Vite dentro de validate | pass con warning | Chunk inicial 721,76 kB, 210,56 kB gzip; umbral de aviso 500 kB |
| npm run preflight:integrity | pass, exit 0 | Solo SELECT: 40 relaciones sin huérfanos; sin duplicados reportados |
| npm run test:coverage | fail, exit 1 | 79,38 % líneas / 89,82 % ramas / 72,34 % funciones; umbral 90 % |
| npm run smoke:rbac | blocked, exit 1 | En entorno aislado, /api/health devuelve 503; no llega a los 12 casos |
| npm -w @wsm/client run test:e2e -- --reporter=line | blocked, exit 1 | Dos pruebas sin iniciar navegador: falta Chromium headless shell |
| Test-CodexTemplate.ps1 sobre el original | pass, exit 0 | 13 rutas esenciales y 5 perfiles; solo estructura de plantilla |
| Reproducción H-01 con dependencias simuladas | fail del criterio funcional | Pedido delivery aceptado por el caso de uso pickup; commit simulado |

Logs locales: `logs/base-codex-2026-09-06/` (ignorados por Git).
Resumen reproducible y alcance de aislamiento en [QUALITY](QUALITY.md).
El reporte de cobertura incluye archivos instrumentados por el runner; no se
presenta como cobertura exclusiva de código productivo ni de todo el repositorio.

## Hallazgos

| ID | Severidad | Archivo/símbolo | Evidencia e impacto | Recomendación | Estado |
|---|---|---|---|---|---|
| H-01 | high | domains/sales/PickupOrderCheckoutUseCase.js:execute | Solo valida estado; acepta shipping_method=delivery y registra entrega | Guard sobre el pedido bloqueado, antes de mutaciones; test negativo delivery + positivo pickup | Abierto |
| H-02 | high | server/package.json:test:coverage | Los tres porcentajes están por debajo de 90 %; validate no ejecuta este gate | Cubrir escenarios de negocio faltantes y añadir cobertura a CI tras resolver el fallo | Abierto |
| H-03 | medium | .github/workflows/ci.yml | No hay jobs de cobertura, E2E, RBAC o MySQL | Añadir pruebas con datos efímeros y evidencia publicable | Propuesto |
| H-04 | medium | .agents/context/PROJECT.md y QUALITY.md anteriores | Backend descrito como TS y lint backend inexistente; ruta de migraciones incorrecta | Alinear documentación con scripts y rutas reales | Corregido documentalmente |
| H-05 | medium | .ai/TASKS.md y docs/execution/STATE.md anteriores | Copia desactualizada, 89 KB de estado y afirmación 100/100 sin gate completo | Fuente canónica, enlaces y archivo histórico | Mitigado documentalmente |
| H-06 | medium | Entorno de tests/smokes | Desarrollo usa DB remota; smoke necesita fixtures reales | Diseñar MySQL de pruebas y guard de aislamiento antes de integrar smokes | Abierto |

H-01 es una reproducción del caso de uso con mocks, no una explotación de la API
ni una operación sobre datos reales. La ruta requiere canSell: el fallo se
refiere a elegibilidad del pedido, no demuestra omisión de autenticación.

## Contrapruebas

- Contrastar “TypeScript completo” con los scripts: no hay check estático del servidor.
- Contrastar “100/100” con cobertura: gate rojo aunque validate esté verde.
- Entregar al caso de uso un pedido packed + delivery: acepta y hace commit simulado.
- Revisar conteo ciego: el controlador elimina cantidades esperadas/desvíos;
  no atribuir un fallo a getSession sin revisar esa capa de salida.

## Límites y decisión

Análisis entregable con hallazgos; cierre integral de calidad de la app pendiente.
No se certificó producción, seguridad exhaustiva, rendimiento de usuarios,
impresión/hardware, integraciones reales ni aislamiento de MySQL concurrente.
No se instalaron navegadores ni dependencias; no se ejecutaron migraciones.

La revisión automática rechazó el primer validate contra el entorno remoto.
Se resolvió esa limitación ejecutándolo con variables y credenciales ficticias
de aislamiento. El preflight SELECT se revisó y autorizó por separado.
RBAC remoto/mutante no se ejecutó; se deja para una base de pruebas controlada.

Ver [informe completo](../../docs/execution/ANALISIS_APP_Y_BASE_CODEX_2026-09-06.md)
y [riesgos](RISKS.md).


## Verificación de la adaptación documental

- 25 documentos Markdown comprobados: 0 enlaces locales rotos.
- 6 archivos TOML parseados: cinco roles de solo lectura, sin modelo/esfuerzo fijos.
- Hashes de 51 archivos preexistentes fuera de los dos snapshots: preservados.
- TASKS reducido de 18,3 KB a aproximadamente 2,2 KB; STATE de 89,1 KB a 1,4 KB.
- Se conservaron copias del historial antes de resumir. No se midió ahorro real de tokens.
