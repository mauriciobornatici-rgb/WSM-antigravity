# Auditoria de Logica Operativa y UX

Fecha: 2026-06-14  
Estado del producto al revisar: 80/100  
Objetivo de esta revision: validar si la aplicacion piensa como un operador real y si los flujos principales son intuitivos, consistentes y seguros.

---

## Resumen Ejecutivo

La app tiene una base logica correcta para avanzar: los modulos principales existen, las rutas estan protegidas por rol, POS valida caja y pagos, recepcion mueve stock dentro de transaccion, pedidos separa preparacion/facturacion, y postventa ya impacta stock/cuenta corriente en escenarios relevantes.

El producto todavia no es 10/10 porque hay tres brechas de experiencia operativa:

1. El usuario no ve aun una trazabilidad integral de producto/lote/pedido desde la UI.
2. Algunas decisiones de negocio estan simplificadas y pueden confundir: por ejemplo, en compras el boton "Aprobar" en realidad pasaba la OC a `sent`.
3. Faltan bandejas de recuperacion para eventos parciales o fallidos: factura POS fallida luego de venta guardada, calidad pendiente, devoluciones en tratamiento, cobros pendientes.

La conclusion experta es: la logica de base es viable, pero hay que convertirla en flujos guiados, visibles y recuperables.

---

## Hallazgos de Logica de Negocio

### 1. Compras y abastecimiento

Estado actual:
- Se puede crear OC en `draft`.
- Se puede pasar OC a `sent`.
- Recepciones toman OCs `sent` o `partial`.
- La aprobacion de recepcion actualiza stock y estado de OC.

Lectura:
- La logica tecnica funciona para una OC simple.
- Falta una etapa formal anterior: solicitud interna/OT de compra y aprobacion separada.
- La palabra "aprobar" no debe significar "enviar al proveedor"; son acciones distintas.

Riesgo:
- En operacion real puede no quedar claro quien pidio, quien aprobo, quien envio, y bajo que criterio.

Prioridad:
- Alta para llegar a 100/100.

Proximo paso recomendado:
- Crear flujo `purchase_requests` u OT interna con estados `requested -> approved/rejected -> converted_to_po`.
- Mantener OC con estados claros: `draft -> sent -> partial -> received -> closed/cancelled`.

### 2. Recepcion, calidad y almacenamiento

Estado actual:
- La recepcion se crea y luego se aprueba.
- Al aprobar, se insertan movimientos de inventario y se actualiza stock por ubicacion.
- Existe endpoint/modelo para quality checks.

Lectura:
- La transaccion de recepcion es una buena base.
- Calidad existe, pero no parece obligatoria ni suficientemente visible para decidir si el stock queda disponible, bloqueado, rechazado o a devolver.

Riesgo:
- Producto recibido con defecto puede entrar como stock disponible antes de control.

Prioridad:
- Alta.

Proximo paso recomendado:
- Introducir estado operativo visible `pending_qc`.
- Separar stock recibido en ubicacion/cuarentena hasta aprobar calidad.
- Mostrar en recepcion una accion clara: "Enviar a calidad", "Aprobar calidad", "Rechazar", "Devolver a proveedor".

### 3. POS y venta

Estado actual:
- POS valida carrito no vacio.
- Requiere caja abierta.
- Valida que los medios de pago sumen exactamente el total.
- Cuenta corriente requiere cliente.
- Aplica UI optimista y rollback si falla la venta.
- Registra pagos de caja por cada medio.

Lectura:
- La logica POS es de las partes mas maduras.
- El manejo de pagos mixtos y caja abierta es correcto para operatoria diaria.

Riesgo:
- Si la venta se guarda pero falla la factura, el operador recibe un toast pero necesita una bandeja visible para reintentar o completar la factura.

Prioridad:
- Media-alta.

Proximo paso recomendado:
- Crear bandeja "Ventas con factura pendiente/error".
- Desde POS/historial permitir reintentar facturacion y reimprimir.

### 4. Pedidos, preparacion y despacho

Estado actual:
- Pedidos tienen estados operativos para preparar, empacar, despachar, entregar y completar.
- Hay diferenciacion visual de `packed` segun retiro/envio.
- Existe soporte de faltantes.

Lectura:
- El modelo mental del operador esta bastante bien encaminado.
- Falta cerrar trazabilidad de envio/recepcion y relacionarlo con timeline.

Riesgo:
- Si despacho y recepcion de envio no quedan como eventos auditables, se pierde trazabilidad post-venta.

Prioridad:
- Media-alta.

Proximo paso recomendado:
- Agregar eventos de envio a timeline.
- Definir estados/incidencias de logistica: `label_created`, `in_transit`, `delivered`, `failed_delivery`, `returned_to_origin`.

### 5. Cuentas corrientes y cobranzas

Estado actual:
- Facturas pueden quedar pendientes.
- Existen pagos parciales/mixtos a nivel servicio.
- Clientes y proveedores tienen saldos.

Lectura:
- La logica existe, pero necesita una pantalla de trabajo dedicada para cobranza y conciliacion.

Riesgo:
- Operadores terminan usando pantallas dispersas y se vuelve dificil saber que cobrar, que pagar y que ya esta conciliado.

Prioridad:
- Alta.

Proximo paso recomendado:
- Pantalla "Cuentas corrientes" con:
  - facturas pendientes
  - pagos parciales
  - notas de credito
  - saldo historico
  - conciliacion por medio
  - exportacion/resumen

### 6. Garantias y devoluciones

Estado actual:
- Garantias, devoluciones de clientes, notas de credito y devoluciones a proveedores existen.
- Devoluciones de cliente pueden reingresar stock, mandar a proveedor o generar perdida.
- Devolucion aprobada puede generar nota de credito y ajustar cuenta corriente.

Lectura:
- La base funcional es buena.
- Falta hacer visible el vinculo completo: venta original, factura, producto/lote/serie, proveedor, garantia y resolucion.

Riesgo:
- El usuario puede registrar el evento, pero no entender rapidamente donde esta parado el caso.

Prioridad:
- Media-alta.

Proximo paso recomendado:
- Vista unica de caso postventa con timeline, SLA, responsable, evidencia y resolucion financiera/logistica.

---

## Hallazgos de UX e Intuicion

### Fortalezas

- Sidebar por modulos y roles: buena estructura mental.
- POS se siente como terminal operativa, no como landing page.
- Pedidos tiene estados reconocibles para trabajo diario.
- Recepciones agrupa pendientes, historial, facturas y devoluciones en una misma zona logica.

### Fricciones detectadas

1. La navegacion no marcaba como activo el modulo padre en rutas hijas.
   - Ejemplo: `/clients/:id` podia dejar al usuario sin contexto lateral.
   - Accion aplicada: `AppLayout` ahora considera activa la ruta padre.

2. Habia textos operativos con acentos faltantes o copy ambiguo.
   - Accion aplicada: limpieza puntual en layout, POS, recepciones y ordenes de compra.

3. La accion de compras decia "Aprobar" aunque el backend cambia la OC a `sent`.
   - Accion aplicada: el boton visible ahora dice "Enviar" y el toast "Orden enviada a proveedor".
   - Deuda restante: falta implementar aprobacion real separada.

4. La trazabilidad ya existe en API, pero no esta visible para el usuario.
   - Esto es la proxima mejora de mayor impacto.

5. Faltan "bandejas de excepcion".
   - Facturas POS fallidas.
   - Stock pendiente de calidad.
   - Pedidos con faltantes.
   - Devoluciones/reclamos sin resolucion.
   - Cobros/pagos pendientes.

---

## Prioridades Recomendadas

### P0 - No negociar

1. Mantener gates verdes.
2. No sumar modulos grandes sin visibilizar trazabilidad.
3. Corregir textos/encoding visibles a medida que aparecen.

### P1 - Impacto directo al 100/100

1. Vista frontend de timeline por producto/SKU/barcode.
2. Timeline extendido con pedidos, facturas, devoluciones y garantias.
3. Calidad como paso visible y bloqueante antes de stock disponible.
4. Cuentas corrientes de clientes/proveedores como pantalla de trabajo.

### P2 - Madurez operativa

1. OT interna/solicitud de compra antes de OC.
2. Bandeja de recuperacion de factura POS pendiente/error.
3. Vista unica de caso postventa.
4. Seguimiento logistico de envios y recepciones.

---

## Porcentaje por Eje Luego de Esta Revision

| Eje | Estado | Lectura |
| --- | ---: | --- |
| Logica POS/caja | 78% | Solida base, falta recuperacion visible de facturacion fallida. |
| Logica compras/recepcion | 68% | Funciona para OC simple; falta OT/aprobacion real y calidad bloqueante. |
| Logica stock/trazabilidad | 70% | Movimientos y timeline backend existen; falta UI y mas fuentes. |
| Postventa | 65% | Buen impacto en stock/finanzas; falta vista de caso y SLA. |
| Cuentas corrientes | 62% | Servicios existen; falta pantalla integral de cobranza/pago. |
| UX intuitiva | 68% | Estructura razonable; se corrigieron fricciones de navegacion/copy; faltan bandejas operativas. |

Puntaje general se mantiene en 80/100 hasta que la trazabilidad sea visible y validada por usuario.

