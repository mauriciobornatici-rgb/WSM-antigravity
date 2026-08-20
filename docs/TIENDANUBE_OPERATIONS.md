# Centro operativo Tiendanube

Estado al 2026-08-20: el desarrollo local está completo y probado contra la base de desarrollo. La publicación hacia una tienda real, la recepción de webhooks públicos y el circuito remoto de pedidos/envíos requieren conectar una tienda de prueba por OAuth sobre un backend HTTPS.

## Diseño operativo

La operación diaria vive en `Tienda online`, no en Configuración:

- `Resumen`: ventas, catálogo, pedidos a preparar y alertas.
- `Catálogo`: búsqueda y paginación servidor, familias, variantes/SKU, stock WMS, altas, publicación, sincronización y bajas.
- `Pedidos`: comprador, contacto, documento, domicilio, ítems, pago, envío y total.
- `Envíos`: múltiples paquetes por pedido, destinatario, destino, estado, tracking y eventos.
- `Clientes`: recurrencia y facturación del canal.
- `Sincronización`: ejecuciones manuales, webhooks, fallos de stock y reintentos.
- `Análisis`: ventas de 90 días, estados de pago, productos y clientes principales.

`Configuración > Tienda Nube` conserva únicamente credenciales, OAuth, ubicación de stock, diagnóstico y webhooks. Así, un catálogo de cientos de productos nunca se carga ni se recorre dentro de Configuración.

El modelo local usa familias comerciales y variantes vinculadas a `products` e `inventory`. Talle y color se publican como atributos alineados de Tiendanube; cada combinación mantiene SKU, precio, costo y stock propios. El WMS local es la fuente de stock.

## Permisos de la app Tiendanube

Solicitar sólo estos scopes:

- `write_products` (implica lectura): crear, actualizar, ocultar y sincronizar productos/variantes.
- `read_orders`: importar ventas y sus ítems.
- `read_customers`: incorporar datos del comprador.
- `read_fulfillment_orders` y `write_fulfillment_orders`: leer y actualizar paquetes, estados y tracking.
- `read_locations`: validar la ubicación usada para stock multi-depósito.

Los scopes oficiales y el flujo OAuth están en [Authentication](https://tiendanube.github.io/api-documentation/authentication). La gestión de múltiples paquetes y sus permisos específicos está en [Fulfillment Order](https://tiendanube.github.io/api-documentation/resources/fulfillment-order) y [Multi Inventory](https://tiendanube.github.io/api-documentation/guides/multi-inventory).

## URLs y variables para staging

En el portal de Partners configurar:

- Redirect/callback: `https://<backend>/api/integrations/tiendanube/callback`
- URL de administración: `https://<frontend>/online-store`
- Preferences URL: `https://<frontend>/settings?tab=tiendanube`
- Webhook operativo: `https://<backend>/api/integrations/tiendanube/webhooks`

Variables mínimas del backend:

```env
APP_BASE_URL=https://<frontend>
CORS_ORIGINS=https://<frontend>
TIENDANUBE_WEBHOOK_URL=https://<backend>/api/integrations/tiendanube/webhooks
TIENDANUBE_USER_AGENT=WSM SportsERP (soporte@dominio.com)
ENCRYPTION_KEY=<clave-aleatoria-de-32-bytes-o-mas>
```

La API se consume en la versión estable `2025-03`. El servicio limita las llamadas salientes a aproximadamente dos solicitudes por segundo, respeta `Retry-After` ante 429 y conserva una cola recuperable para stock. Referencias: [Versioning](https://tiendanube.github.io/api-documentation/versioning), [Product](https://tiendanube.github.io/api-documentation/resources/product), [Order](https://tiendanube.github.io/api-documentation/resources/order) y [Webhook](https://tiendanube.github.io/api-documentation/resources/webhook).

## Activación y prueba controlada

1. Crear o actualizar la app en Partners con los scopes y URLs anteriores.
2. Cargar Client ID y Client Secret en `Configuración > Tienda Nube` y guardar.
3. Ejecutar `Conectar por OAuth` e instalar la app en una tienda de prueba.
4. Presionar `Verificar`; deben quedar token, ubicación y 22 webhooks operativos válidos.
5. Seleccionar el Location ID correcto si la tienda informa más de una ubicación.
6. Crear un producto oculto con dos variantes, publicarlo y comparar SKU/precio/stock en Tiendanube.
7. Crear una compra controlada en la tienda; verificar pedido, comprador, domicilio e ítems en el ERP.
8. Preparar cada fulfillment, registrar tracking y confirmar la actualización remota.
9. Repetir un webhook y verificar idempotencia; simular un 429/fallo de stock y comprobar el reintento.
10. Dar de baja el producto de prueba y confirmar que queda oculto remotamente e inactivo localmente.

No usar una tienda productiva para este primer ensayo. Los access tokens no expiran por tiempo: rotan al reinstalar y quedan invalidados al desinstalar la app, según la documentación oficial de autenticación.

## Evidencia local 2026-08-20

- Migraciones `033` a `036` aplicadas y checksums íntegros.
- Suite final: 113 pruebas de servidor y 41 de cliente; typecheck, lint, build y preflight referencial sin huérfanos.
- Alta real de control: `QA Tiendanube Camiseta 2026`, dos SKU, stock inicial total 5, borrador oculto y sin publicación remota.
- Baja real de control: un segundo borrador temporal fue archivado por ID y quedó con cero coincidencias en el catálogo activo.
- Login, ruta dedicada, siete pestañas, URL directa de Configuración y estados vacíos verificados en navegador sin errores de consola.
- La publicación/importación permanece deshabilitada hasta completar OAuth, evitando operaciones remotas accidentales.
- El producto QA se conserva como evidencia en la base de desarrollo y puede darse de baja desde el módulo cuando termine el ensayo remoto.
