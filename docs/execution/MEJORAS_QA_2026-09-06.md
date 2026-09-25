# Correcciones y QA reproducible — 2026-09-06

Continuación del [análisis y adaptación de Base Codex](ANALISIS_APP_Y_BASE_CODEX_2026-09-06.md), autorizada por el usuario.
El coordinador leyó el código, diseñó los cambios y revisó personalmente cada
entrega. Dos subagentes gpt-5.6-luna, con esfuerzo max, implementaron las tareas.
Se devolvió feedback y se revisaron las correcciones. No hubo un revisor delegado.

## Cambios incorporados

- Retiro en mostrador: exige método pickup, pedido preparado/despachado y turno
  abierto cuando se informa caja. Rechaza estados finales y reintentos. La orden
  se bloquea antes de validar y la respuesta se obtiene dentro de la transacción,
  conservando los ítems y datos enriquecidos de la factura.
- Pruebas de retiro, caja y autenticación: guardas sin escrituras, reservas,
  rollback, idempotencia, versión del token y permisos según el rol de la base.
- POS: corregida la dependencia del efecto de carga. Cliente HTTP: corregida la
  caché de módulos en los tests para que la URL configurada se compruebe realmente.
- `test:server`, `test:coverage` y el backend de `validate` usan un entorno hijo
  con credenciales ficticias y puerto 1. No heredan el destino remoto. El build
  del cliente conserva su configuración normal de producción.
- QA MySQL: contenedor separado, puerto 127.0.0.1:33308, tmpfs y usuario de prueba.
  Bootstrap con guardas, errores de seed propagados y servidor HTTP propio para
  cada smoke. Los scripts respetan ENV_FILE sin recargar el .env habitual.
- CI: Node 24, cobertura 90, E2E Chromium y MySQL efímero con smokes. Se evita
  ejecutar unitarios y cobertura dos veces en el mismo job.

## Fallos detectados con MySQL real

El bootstrap sobre MySQL 8.0.46 permitió detectar incompatibilidades que las
consultas simuladas no comprobaban. El ejecutor adapta únicamente las formas
históricas necesarias; los 42 archivos SQL conservan sus hashes y se registran
los checksums de los statements originales.

1. Altas `ADD COLUMN IF NOT EXISTS`: consulta parametrizada a INFORMATION_SCHEMA
   y ejecución de las acciones faltantes, conservando las demás acciones del ALTER.
   Los errores de sentencias transformadas no se ocultan como duplicados.
2. Migración 002 y numeración: `last_value` se delimita como identificador.
   Es una palabra reservada en MySQL 8. [Manual oficial](https://dev.mysql.com/doc/refman/8.0/en/keywords.html).
3. Migración 039: las cuatro semillas de catálogo derivan hash y nombre
   normalizado de la misma representación agregada. ONLY_FULL_GROUP_BY permanece
   activo. La adaptación reconoce las sentencias originales exactas.

En el contenedor QA se deshabilita únicamente el binlog para crear los triggers
con el usuario de pruebas. Los seis triggers de inmutabilidad se mantienen.
Este entorno no verifica replicación, backups ni PITR.
[Configuración de binlog](https://dev.mysql.com/doc/refman/8.0/en/binary-log.html).

La ejecución de migraciones fue inicialmente rechazada por la revisión automática.
El usuario autorizó después, explícitamente, su ejecución solo en wsm_qa local.
No se ejecutaron migraciones ni mutaciones sobre la base remota.

## Evidencia

Logs locales: `logs/qa-hardening-2026-09-06/`, ignorados por Git.

| Comprobación | Resultado y alcance |
|---|---|
| validate | Exit 0: 7 guards, 431 backend, 62 cliente; lint sin warnings, tipos y build correctos |
| Cobertura backend | 431 tests pasan; gate falla: 81,23 % líneas / 88,82 % ramas / 73,98 % funciones |
| MySQL desde cero | 42 migraciones y cuatro usuarios fixture; exit 0 |
| Segundo bootstrap | Sin nuevas migraciones; seed repetible; exit 0 |
| Reanudación tras fallo | Conserva pasos completados y termina las migraciones pendientes |
| Preflight referencial | 40 relaciones, sin huérfanos ni duplicados reportados en QA |
| RBAC HTTP | 12/12 sobre aplicación efímera y MySQL QA |
| Smoke básico de integridad | 4/4; tres circuitos opcionales omitidos explícitamente |
| Playwright Chromium | 2/2: login correcto y error visible; API simulada |
| Numeración con MySQL | 41 → 42 y lectura persistida dentro de transacción; rollback |
| Catálogo con MySQL estricto | Dos productos agrupados en cuatro opciones; nombre y hash coherentes; rollback |

La cobertura previa era 79,38 / 89,82 / 72,34 %. Mejoran líneas y funciones;
las ramas bajan por el alcance y los caminos incorporados. No se excluyeron
módulos ni se bajaron umbrales. El job de cobertura de CI sigue bloqueante:
esta entrega no deja todos los gates verdes ni certifica producción.

## Beneficios y riesgos restantes

La plantilla ya tiene comandos verificables, riesgos explícitos y continuidad
documentada. El entorno aislado facilita reproducir fallos de instalación y
permisos sin usar datos de operación. Las correcciones protegen el retiro y
reducen respuestas ambiguas después de confirmar una venta.

El adaptador de migraciones añade mantenimiento: nuevas migraciones deben usar
sintaxis válida en MySQL y no ampliar silenciosamente las excepciones históricas.
Los smokes usan pocos datos; no demuestran concurrencia real de ventas/inventario,
impresión, hardware, autenticación completa navegador-servidor, ARCA o Tiendanube.
El workflow se verificó localmente por sus comandos; no se disparó GitHub Actions.

Al cierre se retiraron el contenedor y la red efímeros wsm-qa, liberando sus
recursos. Se pueden recrear con los comandos de QA. La documentación actualizada
se verificó: nueve documentos, 44 enlaces locales y ningún destino faltante.

Próximos pasos: cerrar la deuda de cobertura por dominio, agregar circuitos
operativos con fixtures y comprobar CI/staging antes de cualquier salida.

Consultar [QA](../development/QA.md), [AUDIT](../../.agents/context/AUDIT.md)
y [TASKS](../../.agents/context/TASKS.md).
