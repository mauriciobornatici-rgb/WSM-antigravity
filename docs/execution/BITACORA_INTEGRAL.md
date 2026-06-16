# WSM SportsERP - Bitacora Integral de Producto y Ejecucion

Fecha de snapshot: 2026-06-15  
Estado general estimado: 88/100  
Objetivo final: aplicacion ERP/POS 10/10, trazable de punta a punta, estable, auditable y operable en produccion.

---

## 1. Para Retomar Sin Repetir Trabajo

Este documento es el punto principal de continuidad. Antes de iniciar cualquier bloque nuevo:

1. Leer esta bitacora completa.
2. Leer `docs/execution/STATE.md`.
3. Leer `docs/execution/HANDOFF.md`.
4. Ejecutar o revisar el estado de los gates:
   - backend tests
   - frontend lint
   - frontend tests
   - frontend build
5. Confirmar que no se esta rehaciendo algo marcado como "cerrado".
6. Si se cambia una decision de producto, registrar la nueva decision aca.

Regla operativa:

- Lo que esta en "Decisiones Cerradas" no se reabre sin motivo explicito.
- Lo que esta en "Pendiente Validar" no se considera terminado aunque el codigo exista.
- Lo que esta en "Bloqueante" se resuelve antes de ampliar funcionalidad.

---

## 2. Vision del Producto

WSM SportsERP debe ser un sistema integral para retail deportivo y operaciones de deposito, compras, ventas, caja, facturacion, contabilidad y postventa.

La ambicion no es solo "tener pantallas", sino lograr trazabilidad integral del ciclo completo:

1. Solicitud u OT interna de abastecimiento o pedido.
2. Aprobacion de compra.
3. Orden de compra al proveedor.
4. Recepcion de mercaderia.
5. Control de calidad.
6. Almacenamiento con ubicacion fisica.
7. Reserva, picking y despacho.
8. Venta por POS o pedido.
9. Facturacion.
10. Cobranza y cuenta corriente de cliente.
11. Pago y cuenta corriente de proveedor.
12. Garantias.
13. Devoluciones de clientes.
14. Devoluciones a proveedores.
15. Seguimiento de envios, recepciones, incidencias y auditoria.

El producto 100/100 debe permitir responder, para cualquier unidad o lote:

- De donde vino.
- Cuando entro.
- Quien lo recibio.
- Que control de calidad tuvo.
- Donde se guardo.
- Cuando se reservo.
- Quien lo preparo.
- A quien se vendio.
- Que comprobante lo respalda.
- Si se cobro.
- Si tuvo garantia, devolucion o reclamo.
- Que impacto contable genero.

---

## 3. Estado Actual de Hoy

### Stack y estructura

- Monorepo con npm workspaces.
- Frontend: React, Vite, TypeScript, React Query, Tailwind/shadcn-like UI, Playwright, Vitest.
- Backend: Node.js, Express, MySQL, JWT, Joi/Zod, migraciones SQL.
- Paquete comun: `@wsm/common` con esquemas Zod compartidos.
- Base funcional existente para:
  - POS
  - Inventario
  - Pedidos
  - Picking
  - Clientes
  - Proveedores
  - Ordenes de compra
  - Recepciones
  - Facturacion
  - Caja
  - Contabilidad
  - Garantias
  - Devoluciones
  - Configuracion
  - Auditoria

### Fortalezas reales

- Existe arquitectura modular razonable.
- Hay separacion cliente/servidor/common.
- Hay intencion de contrato compartido con Zod.
- Backend usa SQL parametrizado en las zonas revisadas.
- Hay middleware de autenticacion y autorizacion por roles.
- Hay rate limiting, helmet, CORS configurable y validacion de entorno.
- Hay migraciones versionadas.
- Hay transacciones y locks `FOR UPDATE` en flujos sensibles de stock, recepcion, caja y pagos.
- Hay documentacion previa de continuidad.
- Hay pruebas backend para politicas de password, imagenes, inventario y ventas.
- Hay CI definida en `.github/workflows/ci.yml`.

### Riesgos actuales

El proyecto tiene buena base, pero no esta listo para produccion plena. Hoy la prioridad debe ser estabilizar calidad, contratos y trazabilidad antes de seguir sumando superficie funcional.

Bloqueantes detectados en revision 2026-06-14:

1. `authorizeInvoice` tenia una variable inexistente en audit log. RESUELTO el 2026-06-14.
   - Archivo: `packages/server/services/sales.service.js`
   - Cobertura: `packages/server/test/sales.service.test.js`
   - Estado: backend test agregado y verde.

2. Ruta TiendaNube desalineada entre frontend y backend. RESUELTO el 2026-06-14.
   - Backend: `/api/products/tiendanube/bulk-update`
   - Frontend corregido: `/api/products/tiendanube/bulk-update`
   - Cobertura: `packages/client/src/services/api.test.ts`
   - Estado: frontend unit test agregado y verde.

3. Build frontend fallaba por resolucion de `@wsm/common`. RESUELTO para cliente el 2026-06-14.
   - `packages/common/dist` puede generarse.
   - Cliente ahora resuelve `@wsm/common` por alias explicito a `packages/common/src`.
   - Estado: frontend build verde.

4. Vitest frontend ejecutaba specs Playwright e2e. RESUELTO el 2026-06-14.
   - `packages/client/vitest.config.ts` excluye `e2e/**`.
   - Estado: frontend unit tests verdes.

5. Lint frontend falla con numerosos errores.
   - Predominan `any`, variables no usadas y reglas React Hooks.
   - Estado 2026-06-14: RESUELTO COMO GATE. ESLint queda con 0 errores y 0 warnings.
   - Decision previa: `@typescript-eslint/no-explicit-any` quedo temporalmente como warning para deuda controlada de tipado.
   - Avance: dominio facturacion/postventa tipificado; componentes de nota de credito y `ReturnsAndWarranties` quedan sin warnings focalizados.
   - Avance adicional: API cliente, POS, productos, proveedores, inventario, pedidos, recepciones, dashboard y contabilidad quedan sin warnings de lint.
   - Riesgo restante: deuda de tipos en modulos operativos grandes.
   - Severidad: media.

6. Encoding/mojibake visible en docs y textos.
   - Ejemplo: palabras acentuadas renderizadas con caracteres corruptos.
   - Riesgo: baja calidad percibida, textos confusos, reportes desprolijos.
   - Estado 2026-06-14: mitigacion parcial aplicada en navegacion, POS, recepciones y ordenes de compra.
   - Severidad: media.

7. Runner de migraciones parte SQL por `;`.
   - Riesgo: fragilidad futura con triggers, procedimientos o SQL complejo.
   - Severidad: media.

8. Revision logica/UX 2026-06-14 detecto brechas operativas no bloqueantes pero importantes.
   - Documento: `docs/execution/LOGICA_UX_REVIEW_2026-06-14.md`
   - Compras: falta separar solicitud/OT interna, aprobacion y envio a proveedor.
   - Recepcion/calidad: falta que calidad sea un paso visible y potencialmente bloqueante antes de stock disponible.
   - POS: si falla la factura luego de guardar la venta, falta bandeja visible de recuperacion/reintento.
   - UX: la trazabilidad ya es visible en Inventario, pero falta acceso directo desde cada producto y validacion con datos reales.
   - Severidad: media-alta.

---

## 4. Medicion Actual 100/100

Puntaje general estimado: 88/100.

| Area | Avance | Lectura |
| --- | ---: | --- |
| Cobertura funcional visible | 76% | Muchos modulos existen y estan conectados. Trazabilidad ya es visible desde Inventario y ahora incluye fuentes comerciales/postventa; falta acceso directo por producto y validaciones end-to-end. |
| Integridad de stock y operaciones | 65% | Hay transacciones y reservas. Falta consolidar OT, calidad, ubicaciones, envios e incidencias. |
| Facturacion, caja y cuentas corrientes | 58% | Base existente. Hay riesgo critico en autorizacion y falta flujo dedicado robusto de cobranza/cuenta corriente. |
| Compras y proveedores | 64% | OC, recepcion, pagos y facturas proveedor existen. Se aclaro UX de envio de OC; falta OT/aprobacion real, trazabilidad integral y calidad bloqueante. |
| Postventa | 64% | Garantias/devoluciones existen y ya alimentan el timeline por producto. Falta SLA, bandejas operativas y seguimiento por cliente/proveedor. |
| UX operativa | 68% | Navegacion activa para rutas hijas y copy operativo mejorados; faltan bandejas de excepcion y trazabilidad visible. |
| Calidad tecnica | 70% | Backend tests, frontend unit tests, frontend build y lint pasan con 0 errores y 0 warnings; falta e2e smoke critico. |
| Observabilidad/auditoria | 70% | Audit log existe, se agrego cobertura para autorizacion de factura y el timeline por producto ya cruza inventario, lotes, series, auditoria, ventas, facturas, devoluciones y garantias. Falta timeline integral por entidad. |
| DevEx/continuidad | 76% | Hay bitacora integral, gates recuperados con warnings controlados y tests de contrato nuevos. |
| Preparacion produccion | 48% | Requiere gates verdes, secretos, backups, migraciones, monitoreo, runbook y pruebas e2e. |

Objetivo intermedio sano:

- 70/100: app estable para validacion funcional interna.
- 72/100: gates canonicos definidos y verificados por comandos equivalentes en entorno sin npm global.
- 74/100: deuda `any` reducida por dominio; facturacion/postventa queda tipificada en el frontend.
- 78/100: frontend queda con lint limpio, 0 errores y 0 warnings; deuda `any` visible cerrada.
- 80/100: primer slice real de timeline integral implementado en backend/API cliente.
- 82/100: primer slice frontend de trazabilidad visible desde Inventario.
- 84/100: timeline por producto extendido con eventos comerciales y postventa.
- 84/100: app lista para staging operativo serio con trazabilidad inicial visible y fuentes ampliadas.
- 86/100: integracion Tiendanube preparada con OAuth state, API versionada, stock endpoint actual, HMAC webhook e idempotencia inicial.
- 88/100: cola de reintentos de stock (A2) integrada en backend (con cron de periodicidad) y configurada con panel de control de fallos en UI.
- 90/100: app lista para piloto con usuarios reales y datos controlados.
- 100/100: app lista para operacion productiva robusta, auditable y mantenible.

---

## 5. Definicion de 100/100

La aplicacion llega a 100/100 cuando cumple estas condiciones:

1. Gates tecnicos siempre verdes:
   - backend tests
   - frontend lint
   - frontend unit tests
   - frontend build
   - e2e smoke criticos

2. Trazabilidad completa:
   - timeline por producto
   - timeline por lote
   - timeline por pedido
   - timeline por cliente
   - timeline por proveedor
   - timeline por comprobante
   - timeline por envio/recepcion

3. Stock confiable:
   - no oversell
   - reservas claras
   - ubicaciones fisicas
   - picking verificable
   - faltantes trazables
   - devoluciones con impacto correcto
   - ajustes auditados

4. Compras robustas:
   - solicitud/OT interna
   - aprobacion
   - OC
   - recepcion
   - control de calidad
   - almacenamiento
   - factura proveedor
   - cuenta corriente proveedor
   - pago proveedor

5. Ventas robustas:
   - POS
   - pedido
   - reserva/picking
   - facturacion
   - despacho
   - cobranza
   - cuenta corriente cliente
   - comprobantes imprimibles confiables

6. Postventa robusta:
   - garantias con estado, responsable, evidencia y SLA
   - devoluciones de cliente con inspeccion
   - notas de credito
   - devoluciones a proveedor
   - impacto de stock, cuenta corriente y contabilidad

7. Finanzas confiables:
   - caja por turno
   - cobros parciales/mixtos
   - pagos a proveedores
   - conciliacion basica
   - cuentas corrientes
   - asientos balanceados
   - reportes consistentes

8. Operacion real:
   - roles correctos
   - pantallas rapidas para deposito/caja
   - errores claros
   - sin datos simulados ambiguos
   - manual/runbook actualizado

9. Produccion:
   - migraciones reproducibles
   - backups
   - manejo de secretos
   - logs
   - monitoreo
   - recuperacion ante fallas
   - versionado y changelog.

---

## 6. Decisiones Cerradas

Estas decisiones no se reabren salvo pedido explicito:

1. La fuente canonica del stock es `inventory`; `products.stock_current` es compatibilidad/derivado.
2. El backend debe bloquear oversell, no confiar en validaciones del frontend.
3. El servidor no debe escuchar trafico si la inicializacion de DB falla.
4. En staging/production se exige politica estricta de entorno, salvo override explicito.
5. Las rutas protegidas requieren JWT y RBAC backend, no solo frontend.
6. La factura desde pedido no debe registrar cobro automatico si no hay pagos explicitos.
7. Los cobros deben poder ser parciales y mixtos.
8. El picking debe cerrarse por accion explicita del operador.
9. Las operaciones sensibles deben ser transaccionales y auditables.

---

## 7. Pendiente Validar

Aunque exista codigo, estas zonas necesitan validacion funcional real:

1. Flujo picking completo:
   - pedido pendiente
   - inicio picking
   - escaneo/cantidades
   - cierre sin faltantes
   - cierre con faltantes
   - estado `packed`
   - visibilidad en pedidos

2. Factura desde pedido sin cobro automatico:
   - factura emitida
   - payment_status correcto
   - deuda en cuenta corriente
   - cobro posterior parcial/mixto

3. Recepcion:
   - recepcion contra OC
   - aprobacion idempotente
   - impacto stock
   - impacto cuenta proveedor/factura proveedor

4. Caja:
   - apertura
   - venta
   - cobro
   - ajuste
   - cierre
   - diferencias

5. Postventa:
   - garantia
   - devolucion cliente
   - nota de credito
   - devolucion proveedor
   - impacto stock y financiero.

---

## 8. Roadmap de Prioridades

### P0 - Estabilizacion tecnica inmediata

Objetivo: volver a tener base confiable para trabajar.

Avance actual: 85%.

Tareas:

1. Corregir `authorizeInvoice` para usar `expirationDate`. HECHO.
2. Agregar test backend que cubra autorizacion de factura sin romper audit log. HECHO.
3. Corregir ruta TiendaNube en cliente o backend y agregar prueba/contrato. HECHO.
4. Reparar resolucion de `@wsm/common`. HECHO para cliente.
5. Separar Vitest unitario de Playwright e2e. HECHO.
6. Dejar frontend build verde. HECHO.
7. Dejar backend tests verdes sin intentos reales no mockeados de DB en tests unitarios. HECHO para el caso detectado.
8. Definir comando unico de validacion local. PENDIENTE.

Criterio de cierre:

- Backend tests pasan.
- Frontend lint pasa o queda deuda explicitamente aislada por modulo.
- Frontend unit tests pasan sin ejecutar e2e.
- Frontend build pasa.
- CI puede reproducir lo mismo.

### P1 - Trazabilidad maestra de producto/lote/ubicacion

Objetivo: poder seguir un producto desde compra hasta venta/postventa.

Avance actual: 55%.

Tareas:

1. Definir modelo de timeline operacional. HECHO para primer slice.
2. Consolidar eventos de inventario:
   - creacion producto
   - stock inicial
   - OC
   - recepcion
   - calidad
   - ubicacion
   - reserva
   - picking
   - venta
   - devolucion
   - garantia
   - ajuste
   Estado 2026-06-14: PRIMER SLICE IMPLEMENTADO. `GET /api/traceability/timeline` consolida `inventory_movements`, `product_batches`, `serial_numbers` y `audit_logs` por `product_id`, `sku` o `barcode`.
3. Agregar vista de trazabilidad por producto.
4. Agregar vista de trazabilidad por lote/serie.
5. Agregar busqueda por SKU, barcode, lote, serial, pedido, factura.

Criterio de cierre:

- Desde un producto se ve toda su historia operacional.
- Desde una venta se puede volver al origen de stock.
- Desde una garantia/devolucion se puede ver venta original y recepcion original si aplica.

### P2 - Compras, OT y proveedores

Objetivo: cerrar el circuito de abastecimiento.

Avance actual: 58%.

Tareas:

1. Formalizar OT/solicitud interna de compra.
2. Aprobacion interna con rol y auditoria.
3. Conversion de OT a orden de compra.
4. Recepcion parcial/total contra OC.
5. Control de calidad por item recibido.
6. Almacenamiento con ubicacion sugerida/asignada.
7. Factura proveedor vinculada a recepcion/OC.
8. Cuenta corriente proveedor.
9. Pago proveedor parcial/total.
10. Devolucion a proveedor con impacto financiero/stock.

Criterio de cierre:

- Un proveedor tiene historial claro de OC, recepciones, facturas, pagos, devoluciones y saldo.
- Una OC puede auditarse de punta a punta.

### P3 - Ventas, pedidos, despacho y clientes

Objetivo: cerrar venta desde cotizacion/pedido hasta cobranza y entrega.

Avance actual: 60%.

Tareas:

1. Revisar estado de pedidos y transiciones.
2. Consolidar reserva vs descuento fisico.
3. Picking operativo estable.
4. Seguimiento de despacho/envio.
5. Factura desde pedido sin cobro automatico.
6. Cobranza posterior con pagos parciales/mixtos.
7. Cuenta corriente cliente.
8. Recibos/comprobantes de pago.
9. Timeline cliente.
10. Alertas de deuda y vencimientos.

Criterio de cierre:

- Un cliente muestra facturas, pagos, saldos, devoluciones, garantias y pedidos.
- Un pedido muestra preparacion, despacho, factura, pago y postventa.

### P4 - Calidad, garantias y devoluciones

Objetivo: que postventa no sea un modulo aislado sino parte de la trazabilidad.

Avance actual: 50%.

Tareas:

1. Control de calidad en recepcion.
2. Estados y motivos normalizados.
3. Evidencia/fotos/documentos por reclamo.
4. Garantia cliente con SLA y responsable.
5. Garantia contra proveedor cuando corresponde.
6. Devolucion cliente con inspeccion de condicion.
7. Reingreso a stock solo si corresponde.
8. Nota de credito y cuenta corriente.
9. Devolucion proveedor con remito/documento.
10. Reportes de fallas por producto/proveedor/lote.

Criterio de cierre:

- Cada reclamo tiene origen, responsable, estado, decision, impacto stock y financiero.

### P5 - Finanzas, caja y contabilidad

Objetivo: que el dinero cierre con las operaciones.

Avance actual: 55%.

Tareas:

1. Cobros parciales y mixtos consistentes.
2. Recibos de cobranza.
3. Caja por turno con medios de pago.
4. Conciliacion basica por metodo.
5. Cuentas corrientes cliente/proveedor.
6. Asientos contables sin duplicaciones.
7. Reportes de saldos.
8. Reportes fiscales/IVA.
9. Cierre de caja y trazabilidad de diferencias.
10. Reglas de anulacion/reversion.

Criterio de cierre:

- Lo vendido, cobrado, adeudado, pagado y contabilizado coincide.

### P6 - UX operativa y performance

Objetivo: que usuarios reales puedan operar rapido y sin confusion.

Avance actual: 58%.

Tareas:

1. Limpiar encoding en UI/docs.
2. Homogeneizar textos en espanol Argentina.
3. Optimizar pantallas de deposito, POS y caja.
4. Reducir errores por formularios largos.
5. Mejorar busqueda y filtros.
6. Estandarizar estados vacios, errores y loading.
7. Revisar responsive en modales densos.
8. Medir tiempos de carga.
9. Agregar paginacion donde falte.
10. Validar con flujos reales de operador.

Criterio de cierre:

- Operadores pueden completar tareas criticas sin ayuda tecnica.

### P7 - Produccion, seguridad y operacion

Objetivo: operar con seguridad y continuidad.

Avance actual: 42%.

Tareas:

1. Runbook de despliegue.
2. Runbook de backup/restore.
3. Rotacion de secretos.
4. Variables de entorno por ambiente.
5. Migraciones robustas.
6. Logs estructurados.
7. Monitoreo de errores.
8. Smoke tests post-deploy.
9. E2E criticos.
10. Plan de recuperacion ante fallas.

Criterio de cierre:

- Se puede desplegar, validar, recuperar y auditar sin improvisacion.

---

## 9. Mapa End-to-End Deseado

### Flujo A - Abastecimiento completo

1. OT interna de compra.
2. Aprobacion por rol autorizado.
3. Orden de compra emitida.
4. Recepcion parcial o total.
5. Control de calidad.
6. Alta de lote/serie si aplica.
7. Ubicacion fisica asignada.
8. Stock disponible/reservable.
9. Factura proveedor.
10. Cuenta corriente proveedor.
11. Pago proveedor.
12. Reporte de proveedor y producto.

### Flujo B - Venta por pedido

1. Pedido cliente.
2. Reserva de stock.
3. Picking.
4. Faltantes si existen.
5. Empaque.
6. Despacho/envio o retiro.
7. Factura.
8. Cobranza parcial/total.
9. Cuenta corriente cliente.
10. Cierre del pedido.
11. Postventa si aplica.

### Flujo C - Venta POS

1. Escaneo/busqueda producto.
2. Carrito.
3. Cliente opcional o cuenta corriente.
4. Pago simple o mixto.
5. Factura/ticket.
6. Caja/turno.
7. Stock.
8. Contabilidad.

### Flujo D - Garantia

1. Cliente reclama.
2. Se identifica venta/factura/producto/lote/serie.
3. Se registra garantia.
4. Diagnostico y evidencia.
5. Resolucion:
   - reparacion
   - cambio
   - rechazo
   - nota de credito
   - derivacion a proveedor
6. Impacto stock/cuenta corriente/contabilidad.
7. Cierre con trazabilidad.

### Flujo E - Devolucion cliente

1. Cliente solicita devolucion.
2. Se vincula venta/factura.
3. Se inspecciona condicion.
4. Se decide destino:
   - reingresa a stock
   - va a cuarentena
   - descarte
   - proveedor
5. Se emite nota de credito si corresponde.
6. Se actualiza cuenta corriente.
7. Se registra timeline.

### Flujo F - Devolucion proveedor

1. Se detecta problema en recepcion, calidad, stock o garantia.
2. Se vincula proveedor/OC/recepcion/lote.
3. Se crea devolucion proveedor.
4. Se descuenta o bloquea stock.
5. Se registra documento/remito.
6. Se ajusta cuenta corriente proveedor.
7. Se cierra con resolucion.

---

## 10. Backlog Priorizado Inmediato

Orden sugerido para las proximas sesiones:

1. P1.2 Agregar vista frontend de timeline por producto/SKU.
2. P1.3 Extender timeline con eventos de pedidos, facturas, garantias y devoluciones.
3. P3.1 Cerrar flujo de cobranza de facturas pendientes.
4. P2.1 Formalizar OT interna de compra.
5. P4.1 Control de calidad en recepciones.

No avanzar a nuevas pantallas grandes antes de mantener gates verdes y bajar deuda tecnica visible.

---

## 11. Gates de Validacion

Comandos canonicos esperados cuando el entorno npm este correctamente disponible:

```bash
npm run validate
```

`npm run validate` ejecuta:

```bash
npm -w @wsm/common run build &&
npm -w @wsm/server run test &&
npm -w @wsm/client run lint &&
npm -w @wsm/client run test &&
npm -w @wsm/client run build
```

E2E separado:

```bash
npm -w @wsm/client run test:e2e
```

Nota del snapshot 2026-06-14:

- En esta sesion `npm` no estaba disponible en PATH global.
- `npm run validate` queda definido en `package.json`, pero no pudo ejecutarse textual en este entorno por ausencia de `npm`.
- Se uso Node embebido del runtime de Codex y binarios locales para ejecutar la misma secuencia de validacion.
- Common build: pasa.
- Backend test suite: 14/14 pasan.
- Backend test suite actualizada: 15/15 pasan.
- Frontend unit tests: 5/5 pasan.
- Frontend build: pasa.
- Frontend lint: pasa con 0 errores y 0 warnings.

---

## 12. Reglas de Documentacion

Cada bloque cerrado debe actualizar:

1. Esta bitacora.
2. `docs/execution/STATE.md`.
3. `docs/execution/HANDOFF.md`.
4. `docs/execution/CHANGELOG_EXECUTION.md`.

Formato minimo por cierre:

- Fecha.
- Objetivo.
- Archivos tocados.
- Decision tomada.
- Validaciones ejecutadas.
- Resultado.
- Pendientes generados.
- Nuevo porcentaje estimado si corresponde.

---

## 13. Indicadores de Avance

Cada incremento debe mejorar al menos uno de estos indicadores:

- Gates verdes.
- Menos deuda critica.
- Mayor trazabilidad.
- Menos trabajo manual del operador.
- Menos ambiguedad financiera.
- Menos riesgo de stock incorrecto.
- Mejor recuperacion ante fallas.
- Mejor documentacion para continuar.

Si un cambio no mejora ninguno, probablemente no es prioridad.

---

## 14. Riesgos a Vigilar

1. Seguir agregando pantallas sin cerrar gates.
2. Duplicar logica entre backend, frontend y common.
3. Permitir que contabilidad y caja diverjan.
4. Que stock fisico, reservado y vendido no sean auditables.
5. Que AFIP/facturacion no tenga manejo idempotente.
6. Que e2e y unit tests sigan mezclados.
7. Que las migraciones no sean reproducibles.
8. Que la documentacion diga "pasa" pero el checkout actual falle.
9. Que los roles se validen solo en frontend.
10. Que devoluciones/garantias no impacten finanzas y stock de forma consistente.

---

## 15. Proxima Sesion Recomendada

Arranque recomendado:

1. Ejecutar `npm run validate` si `npm` esta disponible en PATH.
2. Validar con datos reales la pestaña `Inventario -> Trazabilidad`.
3. Agregar acceso directo "Ver trazabilidad" desde cada producto.
4. Crear bandejas de excepcion: facturas POS pendientes/error, calidad pendiente, cobros/pagos pendientes.
5. Volver a medir puntaje.

Meta de la proxima sesion:

- Subir de 84/100 a 86/100.
- Agregar acceso directo desde la tabla de productos y validar trazabilidad con datos reales.

---

## 16. Auditoria Logica/UX 2026-06-14

Documento detallado: `docs/execution/LOGICA_UX_REVIEW_2026-06-14.md`

Conclusion experta:

- La logica general de la app es correcta como base ERP/POS.
- El modelo operativo todavia necesita mas visibilidad y recuperacion ante excepciones.
- POS, recepcion y postventa tienen fundamentos sanos, pero requieren pantallas de seguimiento para no depender de memoria del operador.
- La proxima mejora de mayor impacto es hacer visible la trazabilidad en frontend.

Cambios seguros aplicados durante esta revision:

- `packages/client/src/layout/AppLayout.tsx`
  - La navegacion ahora mantiene activo el modulo padre en rutas hijas.
- `packages/client/src/pages/PurchaseOrders.tsx`
  - Copy ajustado: la accion visible ahora dice "Enviar" porque el estado tecnico pasa a `sent`.
  - Textos operativos corregidos.
- `packages/client/src/pages/Receptions.tsx`
  - Textos operativos corregidos en recepciones, devoluciones, mercaderia e IVA.
- `packages/client/src/pages/POS.tsx`
  - Textos operativos corregidos en categorias, stock, codigo y boton de regreso.

Prioridades derivadas:

1. Validar la vista frontend de timeline por producto/SKU/barcode con datos reales.
2. Timeline con pedidos, facturas, devoluciones, garantias y envios.
3. Calidad como paso visible antes de stock disponible.
4. Bandeja de ventas con factura pendiente/error.
5. Cuentas corrientes como pantalla integral de cobranza/pago.
6. OT interna/solicitud de compra separada de OC.

---

## 17. Trazabilidad Frontend 2026-06-14

Objetivo:

- Hacer visible el primer slice de trazabilidad ya implementado en backend/API cliente.

Archivos:

- `packages/client/src/components/products/TraceabilityPanel.tsx`
- `packages/client/src/components/products/traceabilityUtils.ts`
- `packages/client/src/components/products/traceabilityUtils.test.ts`
- `packages/client/src/pages/Inventory.tsx`

Decision:

- Se agrego una pestaña `Trazabilidad` dentro de Inventario.
- Permite buscar por SKU, codigo de barras o ID interno de producto.
- Muestra eventos normalizados de movimientos, lotes, series y auditoria.
- Se mantuvo el primer slice dentro del flujo WMS/inventario para no crear una pantalla aislada antes de validar uso real.

Pendientes:

- Agregar acceso directo "Ver trazabilidad" desde cada producto.
- Extender backend timeline con envios.
- Validar visualmente con datos reales de la base remota.

---

## 18. Trazabilidad Comercial/Postventa Backend 2026-06-14

Objetivo:

- Ampliar el timeline por producto para que no dependa solo de inventario/lotes/series/auditoria.
- Cubrir el recorrido comercial y postventa inicial: pedido, factura, devolucion de cliente, garantia y devolucion a proveedor.

Archivos:

- `packages/server/services/traceability.service.js`
- `packages/server/test/traceability.service.test.js`
- `packages/server/test/sales.service.test.js`

Decision:

- `TraceabilityService.getTimeline` ahora consolida 9 fuentes:
  - `inventory_movements`
  - `product_batches`
  - `serial_numbers`
  - `audit_logs`
  - `order_items`
  - `invoice_items`
  - `client_return_items`
  - `warranty_claims`
  - `supplier_return_items`
- Los nuevos eventos mantienen el mismo contrato normalizado que consume el frontend: fecha, tipo, titulo, descripcion, cantidad, referencia, origen y metadata.
- Se estabilizo el test de `authorizeInvoice` fijando el reloj del caso; era una prueba fragil porque dependia de la fecha real para calcular vencimiento CAE de tickets.

Validacion:

- TDD aplicado:
  - test rojo confirmado: el servicio devolvia 4 eventos y el nuevo contrato exige 9.
  - implementacion posterior dejo el test verde.
- Backend completo:
  - `node --test test\*.test.js`
  - Resultado: 15/15 tests OK.

Pendientes:

- Agregar eventos de envio/despacho y recepcion logistica al timeline.
- Agregar acceso directo desde filas de producto.
- Validar con datos reales de la base remota que las consultas devuelven eventos representativos por SKU/barcode/product_id.

---

## 19. Tiendanube Ready 2026-06-15

Objetivo:

- Dejar la app tecnicamente lista para conectar una tienda real de Tiendanube sin usar endpoints obsoletos ni webhooks inseguros.

Archivos principales:

- `packages/server/services/tiendanube.service.js`
- `packages/server/controllers/integrationController.js`
- `packages/server/routes/integrationRoutes.js`
- `packages/server/index.js`
- `packages/server/migrations/019_add_tiendanube_integration_state.sql`
- `packages/server/middleware/validationMiddleware.js`
- `packages/server/controllers/settingsController.js`
- `packages/server/test/tiendanube.service.test.js`
- `packages/server/test/settings.validation.test.js`
- `packages/server/test/settings.controller.test.js`
- `packages/client/src/pages/Settings.tsx`
- `.env.example`

Decision:

- API Tiendanube actualizada a `2025-03`.
- Header oficial: `Authorization: Bearer <token>`.
- Stock sync usa `POST /products/{product_id}/variants/stock` con `action=replace`.
- OAuth ahora envia y valida `state` firmado.
- Webhooks ahora verifican `x-linkedstore-hmac-sha256`.
- Express conserva `rawBody` para validar la firma sobre bytes reales.
- Webhook procesa por ID: recibe evento minimo, busca la orden completa por API y crea orden local.
- Ordenes importadas guardan `external_source='tiendanube'` y `external_id`.
- Eventos webhook se guardan en `tiendanube_webhook_events` para idempotencia.
- Perfil publico de empresa ya no expone access token ni client secret.
- Boton frontend de conectar usa `VITE_API_URL`, no `localhost` fijo.

Configuracion necesaria en el panel de Tiendanube:

- Redirect/callback URL:
  - `https://<backend-publico>/api/integrations/tiendanube/callback`
- App/admin/preferences URL:
  - `https://<frontend-publico>/settings?tab=tiendanube`
- Webhook URL recomendado:
  - `https://<backend-publico>/api/integrations/tiendanube/webhooks`
- Scopes minimos:
  - `read_orders`
  - `write_products`
- Scope recomendado si se necesita mas detalle de cliente:
  - `read_customers`

Pendientes antes de probar con tienda real:

- Tener backend publicado por HTTPS; Tiendanube no acepta localhost para webhooks.
- Cargar `Client ID` y `Client Secret` en `Configuracion -> Tienda Nube`.
- Confirmar `VITE_API_URL` del frontend apuntando al backend publico.
- Mapear productos locales con `TN Product ID` y `TN Variant ID`.
- Ejecutar OAuth desde el ERP y luego probar una orden real controlada.

---

## 20. Tiendanube Stock Sync Retry Queue (A2) 2026-06-15

Objetivo:
- Implementar la cola de reintentos para stock sync de Tienda Nube (A2) para prevenir inconsistencias de inventario en fallos API/red.

Archivos:
- `packages/server/migrations/021_create_tiendanube_failed_syncs.sql`
- `packages/server/services/tiendanube.service.js`
- `packages/server/controllers/integrationController.js`
- `packages/server/routes/integrationRoutes.js`
- `packages/server/index.js`
- `packages/server/test/tiendanube.service.test.js`
- `packages/client/src/types/index.ts`
- `packages/client/src/services/api.ts`
- `packages/client/src/pages/Settings.tsx`
- `packages/client/src/components/settings/TiendanubeSettingsTab.tsx`

Decisión:
- Crear tabla `failed_syncs` con clave única `(product_id, tiendanube_variant_id)` de forma que sólo se reintente el último stock real actualizado.
- Capturar errores de `syncStock` de manera segura y escribir en la tabla usando upsert.
- Configurar un interval en `index.js` que se ejecuta cada 5 minutos en el backend (usando `unref()` en el timer).
- Implementar endpoints para listado y reintento (manual y masivo) e integrarlos en la UI de Settings.
- Agregar cobertura de pruebas (3 nuevos tests que cubren el flujo de queueing y procesamiento).

Validación:
- `npm run validate` ejecutado en el workspace raíz.
- Servidor: Todos los 61 tests pasan (100% verde).
- Cliente: Lint, typecheck y producción build pasan con éxito sin advertencias ni errores.

Pendientes:
- Validar el proceso de reintentos y visualización con una tienda de pruebas de Tienda Nube en staging real.
