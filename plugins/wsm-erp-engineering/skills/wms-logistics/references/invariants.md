# Invariantes WMS

## Fuentes de verdad

- Existencia física: `inventory(product_id, location, quantity)`.
- Disponibilidad: existencia menos reservas válidas, cuarentena y ubicaciones no vendibles.
- Ubicación sugerida: `products.location`; nunca reemplaza la existencia por ubicación.
- Trazabilidad: `inventory_movements` y eventos inmutables de la tarea.

## Reservas y picking

- Cada unidad reservada debe pertenecer a una asignación de artículo y ubicación.
- La suma de asignaciones activas de una fila debe coincidir con su reserva agregada.
- Claim de tarea atómico: una tarea activa tiene un solo operario.
- Confirmar exige tarea activa, dueño, versión esperada, ubicación, producto, cantidad e idempotency key.
- Picking mueve stock de origen a staging/packing; despacho o entrega representa la salida definitiva.
- Cancelar libera sólo asignaciones del documento y revierte movimientos ya ejecutados según su estado.

## Recepción y putaway

- Recepción física, control de calidad y putaway son estados distintos aunque los ejecute una persona.
- Mercadería no ubicada permanece en una ubicación técnica de recepción; rechazada va a cuarentena.
- Un artículo recibido puede dividirse entre varios destinos.
- Lote/vencimiento acompañan la asignación y el movimiento cuando correspondan.

## Auditorías

- El conteo es ciego hasta completar.
- El servidor registra verificación de ubicación, operario y cada reconteo.
- El ajuste requiere permiso separado y valida movimientos/reservas posteriores al snapshot.
- Una política explícita bloquea o reconcilia movimientos concurrentes sobre el alcance contado.

## Ubicaciones

- Referencia interna inmutable; código de escaneo único y activo.
- Jerarquía parametrizable mediante padre/nivel, no columnas rígidas por depósito.
- Sólo hojas habilitadas para stock aceptan inventario.
- Orden de recorrido numérico/normalizado; no depende de orden lexicográfico libre.
