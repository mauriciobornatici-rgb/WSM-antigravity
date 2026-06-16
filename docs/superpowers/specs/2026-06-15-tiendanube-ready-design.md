# Tiendanube Ready Design

## Objetivo

Dejar la app preparada para conectar una tienda real de Tiendanube sin depender de supuestos inseguros o endpoints obsoletos.

## Alcance

Este bloque prepara la integracion tecnica:

- Guardado real de credenciales OAuth desde `Configuracion -> Tienda Nube`.
- Cliente API Tiendanube actualizado al formato oficial versionado.
- Sincronizacion de stock usando endpoint de variantes/stock.
- OAuth con `state` firmado para evitar callbacks no iniciados desde el ERP.
- Webhooks con verificacion HMAC.
- Procesamiento de ordenes por ID: el webhook dispara una consulta API para traer la orden completa.
- Idempotencia basica para no procesar dos veces el mismo evento.
- Dedupe de ordenes importadas mediante referencia externa en `orders`.

Queda fuera de este bloque:

- Publicacion o edicion completa de catalogo desde ERP hacia Tiendanube.
- Registro automatico de todos los webhooks posibles.
- UI avanzada de reconciliacion de errores.

## Arquitectura

La integracion queda encapsulada en `packages/server/services/tiendanube.service.js`. El controller solo orquesta OAuth/webhooks y delega reglas de negocio al servicio.

El ERP guarda referencias externas (`external_source`, `external_id`) en `orders` para deduplicar ordenes de Tiendanube sin depender de texto en `notes`. Los webhooks se registran en `tiendanube_webhook_events` con estado `received`, `processed`, `duplicate` o `failed`.

## Decisiones

- API base: `https://api.tiendanube.com/2025-03/{store_id}`.
- Header: `Authorization: Bearer <token>`.
- `User-Agent` obligatorio configurable por env.
- Stock: `POST /products/{product_id}/variants/stock` con `{ action: "replace", value, id }`.
- Webhook: validar `x-linkedstore-hmac-sha256` contra el `client_secret`.
- Payload de webhook: tratar como minimo `{ store_id, event, id }`; no asumir productos embebidos.
- Importacion de orden: consultar `GET /orders/{id}` y mapear productos por SKU.

## Manejo De Errores

- Si faltan credenciales, la integracion devuelve error claro y no intenta requests externos.
- Si el webhook no tiene firma valida, responde `401`.
- Si llega evento duplicado, responde `200` y no reprocesa.
- Si una orden no tiene SKUs mapeables, se registra como fallida para investigacion.
- Si Tiendanube responde `429` o `5xx`, no se rompe el flujo principal de inventario; se registra el error.

## Validacion

- Tests unitarios backend para:
  - schema de settings conserva `integrations`.
  - firma HMAC valida/invalida.
  - OAuth state firmado.
  - URL/header de cliente API.
  - stock sync usa endpoint correcto.
  - webhook procesa orden por ID y deduplica.
  - sync manual usa `orders.external_source/external_id`.
- Suite backend completa.
- Lint/tests/build frontend si se toca UI.

