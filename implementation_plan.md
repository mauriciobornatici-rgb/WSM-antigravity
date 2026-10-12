# Plan de implementación — retiro y QA aislado

Fecha: 2026-09-06. El usuario autorizó proceder y realizar mejoras relacionadas.
El coordinador lee, diseña y revisa personalmente. Los implementadores son
subagentes gpt-5.6-luna con esfuerzo max; no hay auditor delegado.

## Alcance y criterios

1. Retiro mostrador: rechazar delivery y métodos ausentes/inválidos antes de
   escrituras; preservar pickup preparado/despachado; impedir procesar una entrega
   ya finalizada; validar turno abierto cuando se registra caja. Conservar ítems
   de factura y leer la respuesta dentro de la transacción antes del commit.
   Probar guardas, rollback, reservas, respuesta e intentos repetidos.
2. QA reproducible: comandos de tests aislados de .env remotos; MySQL dedicado
   a pruebas por Docker, solo loopback y credenciales ficticias; bootstrap con
   guardas de destino. Smokes deben usar su app efímera local y no otro servidor.
   E2E con Chromium de Playwright y respuestas HTTP simuladas, con aserciones
   observables de éxito/error. CI con entorno explícito y verificaciones aplicables.
3. Cobertura: reforzar escenarios de negocio y fronteras HTTP descubiertos en
   el reporte, sin bajar el umbral del 90 % ni excluir módulos para conseguir verde.
4. Revisión del coordinador: comparar con baseline anterior a cada entrega,
   inspeccionar código vecino y tests, dar feedback a Luna y repetir hasta conformidad.

## Límites

Preservar el trabajo local previo. No cambiar AGENTS/GEMINI, esquemas o datos
remotos; no contactar ARCA/Tiendanube ni desplegar. Bootstrap permitido únicamente
en una base nueva, aislada y dedicada a QA con las migraciones ya existentes;
cualquier necesidad de modificar migraciones se separa y revisa antes de ejecutarla.
No refactorizar módulos enteros sin un beneficio demostrado por esta tarea.

## Reparto inicial

- Luna retiro: caso de uso PickupOrderCheckoutUseCase y sus tests.
- Luna QA: scripts de entorno/test, Docker QA, Playwright y CI; documentación QA.
- Coordinador: diseño de pruebas adicionales, revisión de ambas entregas,
  ejecución independiente de gates y documentación de resultados.

## Evidencia de aceptación

Tests dirigidos, validate, cobertura, preflight referencial, RBAC y E2E.
Si infraestructura impide un gate, describir la causa real y no atribuirle pass.
No ejecutar pruebas contra la base remota para resolver un bloqueo local.

## Diseño de la ampliación de pruebas (lectura personal del coordinador)

- Autenticación: token ausente/alterado/expirado/revocado, usuario inactivo o
  eliminado, origen de cookie inválido, permisos resueltos desde DB; login no
  expone hash ni token en JSON y audita dentro de la transacción.
- Caja: apertura doble, cierre doble, turno inexistente/cerrado, pago repetido,
  conciliación de efectivo, rollback ante error y separación de saldos pendientes
  de facturas/pedidos. Invocar controladores reales con límites SQL simulados.
- Inventario/catálogo: normalización y duplicados, padre de subgrupo obligatorio,
  renombre con stock bloqueado, propagación de nombres, paginación, imágenes
  inválidas, transferencias con usuario trazable y errores de persistencia.
- Integraciones: OAuth sin parámetros/credenciales, secreto no expuesto,
  webhook sin rawBody/firma válida, evento duplicado, procesamiento diferido y
  rollback de configuración. Toda red externa simulada.
- Compras/dashboard: fallback de datos vacíos, totales y agrupación por pedido,
  numeración y error transaccional. No reemplazar comportamientos por mocks del
  propio controlador ni usar aserciones que solo confirmen ausencia de error.

La lectura detectó sintaxis histórica ADD COLUMN IF NOT EXISTS incompatible con
MySQL 8; confirmar en QA. Cualquier corrección del ejecutor debe preservar los
SQL y sus checksums, y probar recuperación/idempotencia sin ocultar fallos.

## Resultado de la ejecución

- Retiro y respuesta transaccional corregidos; revisión personal y feedback completados.
- QA local, guardas, comandos y CI incorporados; MySQL 8.0.46 con 42 migraciones
  desde cero, reanudación y bootstrap repetido verificados. SQL históricos intactos.
- Incompatibilidades de columnas condicionales, last_value y agrupación de catálogo
  resueltas en el ejecutor con adaptaciones acotadas; modo SQL estricto conservado.
- validate pasa: 7 guards, 431 backend, 62 cliente, lint/tipos/build.
- RBAC 12/12, preflight 40 relaciones y E2E 2/2 pasan. Pruebas reales de numeración
  y catálogo con datos ficticios y rollback pasan.
- Cobertura mejorada en líneas/funciones pero todavía insuficiente:
  81,23 / 88,82 / 73,98 %. Las demás pruebas por dominio del diseño quedan como
  trabajo pendiente, sin reducir umbrales ni afirmar cierre integral.

Detalle y límites: [informe de mejoras](docs/execution/MEJORAS_QA_2026-09-06.md).
