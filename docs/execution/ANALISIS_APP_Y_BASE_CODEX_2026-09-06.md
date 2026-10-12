# Análisis de WSM SportsERP y adaptación de Base Codex

Fecha: 2026-09-06. Alcance: estructura de desarrollo, calidad, revisión selectiva
de código y adaptación de la plantilla. El trabajo funcional que ya estaba en
el repositorio se preservó.

## Dictamen

**Base Codex sirve para organizar mejor este proyecto mediante una adopción
selectiva.** Su mayor beneficio aquí es mantener contexto fiable, localizar
riesgos y exigir evidencia. El ERP ya tiene monorepo, contratos compartidos,
permisos e invariantes: no necesita reemplazar su arquitectura con la plantilla.

La salud observada es mixta: `validate` e integridad pasan, pero la cobertura
no cumple el umbral y faltan verificaciones ejecutables de entorno. Además se
reprodujo un defecto de elegibilidad en retiro por mostrador.
Este análisis no habilita producción ni confirma la antigua nota “100/100”.

## Método y alcance real

Se inspeccionaron los cuatro package.json, CI, reglas/contexto existentes,
todos los tipos de archivo de la plantilla, estructura por paquetes y una muestra
de rutas, controladores, servicios, contratos y tests críticos.
Se ejecutaron checks existentes y una contraprueba con mocks.

Roles aplicados por el coordinador: arquitectura, QA, seguridad, mantenibilidad
y continuidad de desarrollo. No hubo subagentes ni auditor independiente.
No se realizó auditoría exhaustiva del código, benchmark, pentest, recorrido
visual completo ni homologación fiscal. No se cambiaron funcionalidades.

## Qué está bien encaminado

- **Separación en tres paquetes:** React/Vite/TypeScript en client; Express y
  JavaScript ESM en server; Zod y RBAC TypeScript en common.
- **Base transaccional:** casos de uso con conexiones inyectables, transacciones
  y locks de filas; reservas y asignaciones WMS explícitas.
- **Reglas de dominio presentes:** restricciones contables en migraciones,
  contra-asientos y redacción de campos del conteo ciego en el controlador.
- **Seguridad por capas:** middleware de autenticación/permisos, cookies HttpOnly,
  validaciones compartidas, cifrado y validación de webhooks.
- **Pruebas útiles ya existentes:** 392 backend y 61 frontend pasan.
- **Cliente con carga por rutas:** App.tsx usa lazy/Suspense; existen componentes
  separados para POS/picking y un portal específico de impresión.

Estas son capacidades identificadas en código y tests; no garantías universales.

## Hallazgos prioritarios de la app

| Prioridad | Hallazgo y evidencia | Consecuencia | Siguiente cambio propuesto |
|---|---|---|---|
| Alta | H-01: PickupOrderCheckoutUseCase.execute valida estado pero no shipping_method | Un pedido delivery puede marcarse entregado a través del flujo de retiro | Validar pickup dentro de la transacción y probar ambos métodos |
| Alta | H-02: cobertura 79,38 % líneas, 89,82 % ramas, 72,34 % funciones | El criterio de 90 % no está satisfecho aunque validate pase | Pruebas de negocio faltantes; después conectar el gate a CI |
| Alta para pruebas con datos | El entorno llamado development apunta a DB remota | Ejecutar smokes/arranque sin inspección puede afectar datos compartidos | Base de integración aislada, fixtures y comprobación de destino |
| Media | CI no incluye cobertura, Playwright, RBAC ni integridad MySQL | No reproduce todas las condiciones de cierre documentadas | Job dedicado con DB efímera y navegador |
| Media | Backend JS sin lint/typecheck en scripts, documentado como TS | Sobreestima garantías y facilita divergencias de contratos | Documentación corregida; evaluar chequeos estáticos por dominio |
| Media | Servicios/pantallas grandes y chunk inicial de 721,76 kB | Aumenta superficie de revisión; posible coste de carga, aún no medido | Medir y separar responsabilidades en cambios acotados |
| Media | TASKS alternativo desactualizado y STATE de 89.107 bytes | Más lectura y riesgo de decisiones sobre información vieja | Historial conservado; estado breve y enlaces canónicos |

No se propone convertir todo el servidor a TypeScript ni dividirlo en
microservicios. Conviene empezar por límites funcionales y pruebas de los
flujos de mayor riesgo, manteniendo el despliegue y los contratos actuales.

### Reproducción H-01

Entrada simulada: pedido `status=packed`, `shipping_method=delivery`.
Se inyectaron pool, factura y auditoría en memoria; no hubo conexión SQL real.
`execute` aceptó el pedido, emitió el UPDATE a delivered y realizó un commit
simulado. La ruta `POST /api/orders/:id/pickup-checkout` exige `canSell`,
pero ni el schema del payload ni el controlador verifican el método del pedido.

Ubicaciones:
[caso de uso](../../packages/server/domains/sales/PickupOrderCheckoutUseCase.js),
[ruta](../../packages/server/routes/salesRoutes.js),
[schema](../../packages/common/src/schemas/order.ts) y
[tests actuales](../../packages/server/test/pickup-order-checkout.test.js).
La corrección queda propuesta para la siguiente etapa.

### Áreas de mantenibilidad medidas

| Archivo | Líneas observadas |
|---|---:|
| tiendanube.service.js | 1821 |
| sales.service.js | 1440 |
| finance.service.js | 1002 |
| client/src/services/api.ts | 953 |
| ProductCatalogCard.tsx | 920 |
| POS.tsx | 825 |

Estas cifras priorizan lectura; no prueban por sí solas mala arquitectura.
Candidatos: separar consultas/operaciones de ventas, sincronización y webhooks
de Tiendanube, contratos por dominio y selección de variantes del catálogo POS.
Cada extracción debería conservar API, transacciones y pruebas de regresión.

## Comparación con la plantilla

| Aspecto | WSM antes | Base Codex | Adaptación elegida |
|---|---|---|---|
| Reglas | AGENTS/GEMINI con invariantes específicas | Contrato genérico del coordinador | Conservar reglas WSM |
| Memoria | .agents/context y .ai duplicadas | .ai como memoria durable | .agents/context canónico; .ai como referencias |
| Estado | Historial largo en STATE/TASKS | Checkpoint resumible | Archivar copias íntegras y resumir presente |
| Arquitectura/riesgos | Información dispersa | ARCHITECTURE/RISKS dedicados | Mapas reales y registro priorizado |
| Calidad | Checks reales con descripciones inexactas | Matriz de aceptación/evidencia | Alcance exacto de cada comando |
| Roles | Documentos del plugin WSM | Cinco perfiles TOML de lectura | Copiar y especializar sin modelos fijos |
| Auditoría | Evidencia histórica mezclada con conclusiones | Protocolo independiente | Separar revisión propia de auditoría no ejecutada |
| Instalación | Proyecto existente con trabajo local | Copia solo archivos ausentes | Adaptación selectiva, preservando conflictos |

El instalador original evita sobrescrituras, pero no resuelve dos fuentes de
estado ni adapta comandos. Su verificador confirma archivos/campos; no valida
invariantes, configuración efectiva de una sesión ni el software resultante.

## Beneficios y riesgos

| Incorporación | Beneficio esperado | Riesgo | Control adoptado |
|---|---|---|---|
| Estado breve y archivo histórico | Retomar sin releer toda la evolución | Perder detalles al resumir | Copias exactas previas y enlaces |
| Una fuente por dato | Menos contradicciones entre herramientas | Romper rutas usadas por sesiones anteriores | Índices de compatibilidad en .ai |
| Mapa de arquitectura | Encontrar rápido productores/consumidores | Quedar desactualizado | Mapa de límites, no catálogo de funciones |
| Registro de riesgos/evidencia | Priorizar por impacto demostrable | Burocracia o métricas engañosas | Actualizar por hitos; resultados fechados |
| Especialistas acotados | Revisiones enfocadas cuando aporten valor | Más tokens, latencia y sesgos compartidos | Un coordinador por defecto; máximo dos especialistas configurados |
| Revisión según riesgo | Detectar escenarios fuera del camino feliz | Confundir revisión IA con certificación | Declarar independencia, alcance y checks no realizados |
| Adopción gradual | Cambios revisables y reversibles | Plantilla parcial mal interpretada | Mapa de qué se copió y qué se conservó |

El beneficio previsto es operativo. No se midió ahorro de tokens, horas ni
rendimiento funcional, y no se promete un porcentaje de mejora.

## Qué quedó incorporado

- [Guía de desarrollo](../development/README.md), modelo operativo y protocolo.
- [Plan de revisión](../../PLANS.md).
- Arquitectura, riesgos y evidencia dentro de la fuente canónica.
- Estado y tareas resumidos; [historial original](archive/base-codex-2026-09-06/README.md).
- Descripciones de calidad alineadas con los scripts, y correcciones factuales
  de lenguaje del backend/ruta de migraciones.
- Cinco perfiles TOML copiados de Base Codex y ajustados a WSM.
- Compatibilidad de rutas `.ai/` mediante referencias, evitando otra memoria.

Ver [mapa completo de incorporación y reversión](../development/BASE_CODEX_ADOPTION.md).
No se modificaron AGENTS, GEMINI, reglas de negocio, dependencias ni CI.

## Verificación realizada

| Check | Resultado |
|---|---|
| typecheck | Aprobado |
| validate aislado de DB remota | Aprobado: 392 backend + 61 frontend |
| ESLint / Vite | Sin errores, con aviso de useEffect en POS:246 y tamaño de chunk |
| preflight de integridad, solo SELECT | Aprobado: 40 relaciones sin huérfanos |
| cobertura backend | Falló el gate de 90 % en las tres métricas |
| smoke RBAC aislado | Bloqueado: health 503 por ausencia de DB de pruebas |
| E2E de login | Bloqueados: falta el ejecutable de Chromium |
| Verificador de Base Codex original | Aprobado; estructura del kit |
| Contraprueba pickup/delivery | Defecto reproducido con mocks |

Node local usado: 24.15.0; CI declara Node 20. No se comprobó paridad de runtime.
Los tests operacionales que usan mockPool no sustituyen concurrencia/triggers
sobre MySQL real. La integridad referencial tampoco demuestra balance contable,
ausencia de stock negativo ni que todas las reglas del negocio se cumplan.

La revisión automática rechazó validate en el entorno remoto por posibles
mutaciones no verificadas. Se ejecutó una alternativa aislada que pasó.
El preflight SELECT fue autorizado tras inspección independiente de su código.
No se conectaron smokes mutantes a la base remota.

## Cómo seguir

1. **Primero, corrección acotada de H-01.** Criterio: rechazar delivery sin
   mutaciones y conservar retiro válido, factura y caja. Después revisar el
   resto del flujo de cobro/reintentos con pruebas negativas.
2. **Después, entorno de QA reproducible.** Base MySQL aislada, fixtures y
   Chromium; demostrar RBAC, transacciones y E2E, sin usar la DB compartida.
3. **Luego, cobertura y CI.** Priorizar escenarios que protejan dinero/stock,
   alcanzar el gate vigente y añadir la evidencia faltante al pipeline.
   Refactorizar servicios/componentes en incrementos separados y medidos.

Las migraciones, despliegues e integraciones reales siguen sujetos a las reglas
vigentes. ARCA y Tiendanube permanecen en la etapa de homologación prevista.
Estas son propuestas para acordar con el usuario, no cambios ya ejecutados.

## Fuentes

Evidencia local: package.json de raíz y paquetes, .github/workflows/ci.yml,
fuentes enlazadas, [AUDIT](../../.agents/context/AUDIT.md) y registros de ejecución.
Plantilla: Base Codex 2.0.0, changelog del 2026-09-02.

Para comprobar el formato de especialistas y el alcance de opciones locales se
consultaron [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
y [Configuration Reference](https://learn.chatgpt.com/docs/config-file/config-reference)
de OpenAI el 2026-09-06. Esta comprobación no equivale a ejecutar los agentes.
