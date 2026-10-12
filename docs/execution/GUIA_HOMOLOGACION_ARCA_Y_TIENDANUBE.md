# WSM SportsERP — Guía Integral de Homologación Externa
## Manual de Ensayos Controlados para ARCA (AFIP) y Tiendanube (Sandbox)

**Versión:** 1.0  
**Fecha:** Septiembre 2026  
**Ámbito:** Entorno de Pruebas / Homologación (Staging)

---

## 1. Introducción y Objetivos

Este documento detalla el procedimiento oficial y los pasos técnicos requeridos para realizar los ensayos controlados de conectividad externa con:
1. **ARCA (ex AFIP)**: Facturación electrónica mediante Web Services (WSAA para autenticación y WSFE para comprobantes A, B y C con obtención de CAE y código QR oficial).
2. **Tiendanube**: Plataforma de comercio electrónico mediante API REST v2025-03, ciclo OAuth 2.0, webhooks idempotentes y sincronización de existencias WMS.

> **Importante**: Ambos ensayos deben ejecutarse exclusivamente con credenciales y certificados emitidos para **ambientes de prueba / homologación** (Testing), sin costo fiscal ni impacto en la operativa tributaria o comercial real de la empresa.

---

## 2. Bloque 1: Homologación ARCA (AFIP Facturación Electrónica)

### 2.1 Requisitos Previos
- CUIT de prueba o CUIT del contribuyente habilitado con Clave Fiscal nivel 3.
- Computadora con terminal (OpenSSL instalado).
- Acceso al panel de administración de WSM SportsERP (`/settings`).

---

### 2.2 Generación del Certificado de Prueba (OpenSSL)

1. **Generar la clave privada (Private Key)**:
   ```bash
   openssl genrsa -out afip_testing.key 2048
   ```
2. **Generar el archivo de solicitud de certificado (CSR)**:
   ```bash
   openssl req -new -key afip_testing.key -subj "/C=AR/O=WSM_DEPORTES/CN=WSM_HOMOLOGACION/serialNumber=CUIT 20XXXXXXXX9" -out afip_testing.csr
   ```
   *(Reemplazar `20XXXXXXXX9` por el CUIT correspondiente).*

---

### 2.3 Autorización en el Portal de AFIP (Homologación)

1. Ingresar al portal de AFIP con Clave Fiscal: [https://auth.afip.gob.ar](https://auth.afip.gob.ar).
2. Adherir el servicio **"WSASS - Autogestión Certificados Homologación"** desde el Administrador de Relaciones de Clave Fiscal.
3. Ingresar al servicio **WSASS** y seleccionar:
   - **Nuevo Certificado**: Pegar el contenido del archivo `afip_testing.csr`.
   - Descargar el certificado digital emitido con extensión `.crt` (ej. `afip_testing.crt`).
4. **Vincular el servicio de negocio (WSFE)**:
   - En WSASS, ir a "Autorización a Servicios".
   - Seleccionar el certificado recién creado.
   - En el menú desplegable de servicios, vincular **"wsfe" (Facturación Electrónica)**.
5. **Dar de alta un Punto de Venta para Web Services**:
   - Ingresar al servicio **"Administración de Puntos de Venta y Domicilios"**.
   - Agregar un punto de venta (por ejemplo, `0002` o `0005`).
   - En "Tipo de emisión", seleccionar **"RECE para aplicativo y/o web service"**.
   - Guardar y anotar el número de punto de venta asignado.

---

### 2.4 Carga de Credenciales en WSM SportsERP

1. En el menú lateral del ERP, ingresar a **Configuración** (`/settings`).
2. Desplazarse a la sección **"Facturación Electrónica & ARCA"**:
   - **Ambiente**: Seleccionar `Homologación / Testing`.
   - **CUIT emisor**: Ingresar el CUIT autorizado.
   - **Punto de Venta**: Ingresar el número configurado (ej: `2`).
   - **Certificado Digital**: Copiar y pegar el contenido íntegro de `afip_testing.crt` (incluyendo `-----BEGIN CERTIFICATE-----` y `-----END CERTIFICATE-----`).
   - **Clave Privada**: Copiar y pegar el contenido de `afip_testing.key`.
3. Presionar **Guardar Configuración**.
   - *Nota de seguridad*: El sistema cifra automáticamente ambos archivos mediante el algoritmo simétrico **AES-256-GCM** antes de persistirlos en la base de datos.

---

### 2.5 Protocolo de Ensayo Controlado (Paso a Paso)

| Paso | Acción | Resultado Esperado en WSM SportsERP |
|---|---|---|
| **1** | Ir a **Configuración** y pulsar *"Probar Conexión AFIP"*. | Respuesta HTTP 200: "WSAA autenticado correctamente. Token & Sign vigentes por 12 horas". |
| **2** | Ir a **Ventas > POS** o **Pedidos**. | Crear una venta de prueba a un cliente de prueba con condición "Consumidor Final" por $1.000. |
| **3** | En el Checkout, marcar la casilla *"Emitir comprobante fiscal"* con Tipo `Factura B`. | La venta se confirma localmente en estado `issued`. |
| **4** | Ingresar al detalle de la factura o presionar *"Autorizar CAE"*. | Se invoca WSFE en sandbox. El servidor de AFIP retorna: CAE (14 dígitos), Fecha de Vencimiento de CAE y número correlativo oficial. |
| **5** | Visualizar la impresión de comprobante (A4 o Ticket Térmico 80mm). | El comprobante muestra el número legal `B-0002-00000001`, CAE, Vencimiento y el Código QR oficial de AFIP escaneable. |
| **6** | Verificar el libro mayor en **Finanzas > Contabilidad**. | Se verifica la partida contable automática: Débito a Deudores por Ventas / Caja y Crédito a Ventas e IVA Débito Fiscal. |

---

## 3. Bloque 2: Homologación Tiendanube (Sandbox de Comercio Electrónico)

### 3.1 Requisitos Previos
- Cuenta en el Portal de Partners de Tiendanube: [https://partners.tiendanube.com](https://partners.tiendanube.com).
- Tienda de prueba gratuita (Sandbox Store).
- Servidor de WSM SportsERP con acceso a internet (para recibir webhooks, se recomienda un túnel HTTPS como ngrok o Cloudflare Tunnel si se prueba en localhost).

---

### 3.2 Creación de la Aplicación en el Portal de Partners

1. En el Portal de Partners, ir a **Mis Aplicaciones > Crear Aplicación**.
2. Configurar los siguientes parámetros:
   - **Nombre**: `WSM SportsERP Staging`
   - **URL de Redirección (OAuth Callback)**: `https://<tu-dominio-o-ngrok>/api/tiendanube/oauth/callback`
   - **Permisos requeridos (Scopes)**:
     - `read_products`, `write_products`
     - `read_orders`, `write_orders`
     - `read_customers`, `write_customers`
     - `read_shipping`, `write_shipping`
3. Al guardar, Tiendanube proporcionará:
   - **Client ID** (App ID)
   - **Client Secret** (Secreto de aplicación)

---

### 3.3 Conexión y Vinculación desde WSM SportsERP

1. En el menú lateral de WSM SportsERP, ir a **Tienda online > Configuración**.
2. Ingresar el **Client ID** y **Client Secret**.
3. Presionar el botón **"Conectar con Tiendanube"**:
   - El sistema redirigirá a la pantalla de autorización de Tiendanube.
   - Aceptar los permisos para la tienda de prueba.
   - Al retornar, el estado cambiará a **Conectado (Tienda: ID XXXXXX)**.
4. En la pestaña de diagnóstico, verificar que se detecte la **Ubicación de Stock (Location ID)** principal de la tienda.

---

### 3.4 Registro y Verificación de Webhooks

WSM SportsERP cuenta con auto-registro de webhooks.
1. En **Tienda online > Configuración**, presionar **"Sincronizar Webhooks"**.
2. El sistema registrará automáticamente los siguientes eventos:
   - `order/created`, `order/paid`, `order/fulfilled`, `order/cancelled`
   - `product/created`, `product/updated`, `product/deleted`
3. En la tabla de webhooks registrados debe figurar el estado verde con código de respuesta HTTP 200.

---

### 3.5 Protocolo de Ensayo Controlado (Paso a Paso)

| Paso | Acción en Tiendanube / WSM | Resultado Esperado |
|---|---|---|
| **1** | En WSM SportsERP, ir a **Inventario > Catálogo**. Crear un producto con SKU `TEST-TN-001`, precio $15.000 y stock 10 unidades en depósito General. | Producto creado localmente con trazabilidad inicial. |
| **2** | En **Tienda online > Catálogo**, presionar *"Publicar en Tiendanube"*. | El producto aparece publicado en el panel de control de la tienda online con fotos, precios y stock sincronizado (10 un.). |
| **3** | En la tienda online pública (storefront de prueba), simular una compra de 2 unidades de `TEST-TN-001`. | La compra se completa en Tiendanube con orden `#1001`. |
| **4** | Observar el ingreso de la orden en WSM SportsERP (**Tienda online > Pedidos**). | El webhook de Tiendanube ingresa de forma atómica: se crea la orden en WSM, se asigna el cliente y se descuentan 2 unidades de stock en reserva (`reserved_quantity`). |
| **5** | En WSM SportsERP, ir a **Picking > Pedido #1001**. Realizar el escaneo de depósito y transicionar a `packed`. | El stock físico se reduce de 10 a 8 unidades en WSM y la API sincroniza inmediatamente las 8 unidades disponibles hacia Tiendanube. |
| **6** | Simular pérdida de conexión o reintento de webhook. | La capa de idempotencia de WSM descarta eventos duplicados (`409 / Duplicate replay`), garantizando que no se dupliquen ventas ni asientos contables. |

---

## 4. Matriz de Residuos y Limpieza Post-Ensayo

Una vez finalizados los ensayos en el entorno de pruebas:
1. **Comprobantes AFIP de prueba**: No requieren anulación en AFIP (el ambiente de testing reinicia periódicamente sus secuencias), pero se sugiere registrar notas de crédito en WSM para dejar el balance contable de prueba en cero.
2. **Productos de prueba en Tiendanube**: Pueden ser despublicados o eliminados desde **Tienda online > Catálogo**.
3. **Desconexión segura**: Si se desea volver a aislar el entorno, presionar **"Desconectar Tiendanube"** en Configuración para revocar tokens y remover los webhooks.

---

**WSM SportsERP — Documentación Técnica de Salida a Producción**
