# WSM SportsERP — Descripción Funcional del Sistema

**Versión:** 1.0 — Fase 1  
**Fecha:** Febrero 2026  
**Desarrollado por:** Antigravity Systems

---

## 1. Objetivo General

WSM SportsERP es un **sistema integral de gestión comercial (ERP/POS)** diseñado a medida para empresas de retail deportivo. Su objetivo principal es centralizar, automatizar y optimizar las operaciones diarias del negocio en una única plataforma unificada, abarcando desde la venta en mostrador hasta la contabilidad, pasando por la gestión de inventario, compras, postventa y administración de clientes y proveedores.

El sistema está construido como una **aplicación web moderna** accesible desde cualquier navegador, lo que permite operar desde computadoras de escritorio, notebooks y tablets sin necesidad de instalar software adicional.

---

## 2. Alcance Funcional

El sistema cubre las siguientes áreas operativas del negocio:

| Área | Módulos | Objetivo |
|------|---------|----------|
| **Ventas** | POS, Pedidos, Facturación | Registrar ventas, generar pedidos y emitir comprobantes |
| **Logística** | Inventario, Picking, Recepciones | Controlar stock, preparar pedidos y recibir mercadería |
| **Compras** | Proveedores, Órdenes de Compra, Recepciones | Gestionar el ciclo de abastecimiento completo |
| **Finanzas** | Caja, Contabilidad, Facturación | Controlar flujo de dinero, turnos de caja y reportes |
| **Clientes** | Clientes, Cuenta Corriente | Administrar la cartera de clientes y sus saldos |
| **Postventa** | Garantías, Devoluciones, Notas de Crédito | Gestionar reclamos y devoluciones post-compra |
| **Administración** | Configuración, Usuarios, Auditoría | Configurar el sistema y administrar accesos |

---

## 3. Descripción de Módulos

### 3.1 Dashboard (Panel de Control)

Pantalla principal del sistema que presenta un resumen ejecutivo del estado del negocio en tiempo real. Al ingresar, el usuario visualiza:

- **Ventas del día:** Monto total facturado con cantidad de operaciones y comparación porcentual contra el día anterior.
- **Pedidos en depósito:** Cantidad de pedidos pendientes de preparación, con indicación de cuántos están listos para despacho.
- **Alertas de stock bajo:** Cantidad de productos cuyo stock actual está por debajo del mínimo configurado.
- **Rendimiento operativo:** Porcentaje de pedidos cerrados (entregados o completados) sobre el total de pedidos activos.
- **Gráfico de ventas semanales:** Visualización de barras que muestra la evolución de ventas en los últimos 7 días.
- **Actividad reciente:** Feed con las últimas 5 transacciones o movimientos registrados.

### 3.2 Punto de Venta (POS)

Interfaz de venta rápida en pantalla completa, diseñada para operación en mostrador. Permite registrar ventas de forma ágil mediante:

- **Catálogo de productos** con vista en grilla y búsqueda en tiempo real.
- **Lectura de código de barras y SKU** para agregar productos al carrito escaneando con pistola o ingresando manualmente.
- **Carrito interactivo** con ajuste de cantidades, eliminación de items y cálculo automático de totales.
- **Cobro dividido (split payment):** Permite dividir el pago en múltiples métodos simultáneos: efectivo, tarjeta de débito, tarjeta de crédito, transferencia bancaria, QR y cuenta corriente del cliente.
- **Selección de tipo de comprobante:** El cajero elige si emitir Factura A, Factura B o Comprobante X.
- **Creación rápida de cliente** sin salir de la pantalla de venta, para asociar la operación a un cliente nuevo.
- **Descuento automático de stock** al confirmar la venta.

**Relación con otros módulos:** Al concretar una venta, el POS descuenta stock del módulo de Inventario, genera una transacción en el módulo de Contabilidad, y puede crear una factura en el módulo de Facturación. Si el cliente tiene cuenta corriente, el saldo se actualiza automáticamente en el módulo de Clientes.

### 3.3 Gestión de Inventario

Módulo central para el control del catálogo de productos y niveles de stock:

- **Alta, edición y eliminación de productos** con validación de duplicados por SKU.
- **Campos del producto:** Nombre, descripción, SKU, código de barras, marca, categoría, subcategoría, ubicación en depósito, precio de costo, precio de venta, stock actual, stock mínimo.
- **Alertas automáticas** cuando el stock actual cae por debajo del mínimo configurado.
- **Búsqueda y filtrado** con paginación para gestionar catálogos extensos.

**Relación con otros módulos:** El inventario es el eje central del sistema. Las ventas del POS y los pedidos descuentan stock; las recepciones de mercadería lo incrementan; las devoluciones de clientes lo reingresan; y las devoluciones a proveedores lo descuentan. Los productos del inventario se muestran en el POS, en los pedidos y en las órdenes de compra.

### 3.4 Gestión de Pedidos

Permite crear y administrar pedidos de clientes con un flujo de trabajo completo que conecta la venta con el depósito:

- **Creación de pedidos** seleccionando cliente (o creando uno nuevo), productos con cantidades, método de pago y método de envío (retiro en tienda, envío, envío express).
- **Flujo de estados:** El pedido atraviesa las siguientes etapas:
  1. **Pendiente** → El pedido fue creado y espera preparación.
  2. **En Preparación (Picking)** → El depósito está armando el pedido.
  3. **Empaquetado** → El pedido fue armado y está listo para despachar.
  4. **Despachado** → El pedido fue entregado al transporte.
  5. **Entregado** → El cliente recibió el pedido.
  6. **Completado** → Ciclo cerrado.
  7. **Cancelado** → El pedido fue anulado.
- **Filtrado por estado** para que cada área (ventas, depósito, despacho) vea solo los pedidos relevantes.
- **Generación de factura** directamente desde el pedido.

**Relación con otros módulos:** Los pedidos se vinculan con Clientes (asociación), Inventario (reserva de stock), Picking (preparación física), Facturación (emisión de comprobante) y Contabilidad (registro de la operación).

### 3.5 Picking de Depósito

Pantalla especializada para el personal de depósito que debe preparar los pedidos físicamente:

- **Vista optimizada por pedido** que muestra todos los items a recolectar.
- **Ordenamiento por ubicación en estantería** para minimizar recorridos dentro del depósito.
- **Escaneo de productos por código de barras** para confirmar que se está tomando el producto correcto.
- **Registro de faltantes:** Si un producto no está disponible físicamente, el sistema permite registrar la cantidad real recolectada vs. la solicitada.
- **Cierre con faltantes:** Opción de cerrar el picking con cantidades parciales, generando un indicador de "shortage" (faltante) en el pedido.
- **Transición automática** del pedido a estado "Empaquetado" una vez completado el picking.

**Relación con otros módulos:** El Picking toma pedidos del módulo de Pedidos, consulta ubicaciones del módulo de Inventario, y al finalizar actualiza el estado del pedido para que Despacho pueda continuar.

### 3.6 Gestión de Clientes (CRM)

Sistema completo de administración de la cartera de clientes:

- **Listado con tarjetas de resumen** que muestran métricas como total de clientes, clientes activos y clientes potenciales.
- **CRUD completo** con validación de duplicados por CUIT/CUIL.
- **Datos del cliente:** Nombre/razón social, CUIT, email, teléfono, dirección, límite de crédito.
- **Ficha detallada del cliente** que incluye:
  - **Cuenta corriente** con saldo actualizado en tiempo real.
  - **Historial de movimientos:** Ventas, pagos recibidos, notas de crédito, devoluciones y ajustes.
  - **Historial de facturas** con estado de pago (pendiente, parcial, pagado).
  - **Historial de garantías y devoluciones.**
  - **Registro de pagos** con múltiples medios de pago simultáneos.
  - **Impresión de comprobantes de pago.**

**Relación con otros módulos:** Los clientes se vinculan con Pedidos (quién compra), POS (cliente de mostrador), Facturación (destinatario del comprobante), Devoluciones y Garantías (postventa), y Contabilidad (movimientos financieros).

### 3.7 Gestión de Proveedores

Administración de la cartera de proveedores del negocio:

- **CRUD completo** con datos de contacto, CUIT, dirección, email y teléfono.
- **Historial de órdenes de compra** realizadas a cada proveedor.
- **Cuenta corriente del proveedor** con saldo adeudado.
- **Registro de pagos a proveedores** con selección de método de pago, monto y referencia.

**Relación con otros módulos:** Los proveedores se vinculan con Órdenes de Compra (a quién se le compra), Recepciones (de quién se recibe mercadería), Devoluciones a Proveedor (reclamos de calidad) y Contabilidad (pagos realizados).

### 3.8 Órdenes de Compra

Gestión del proceso de solicitud de compra de mercadería:

- **Creación de órdenes** seleccionando proveedor, productos, cantidades y precios de compra.
- **Flujo de estados:**
  1. **Borrador** → La orden fue creada pero no enviada.
  2. **Enviada/Pendiente** → Enviada al proveedor.
  3. **Aprobada** → Autorizada internamente para recepción.
  4. **Parcialmente recibida** → Parte de la mercadería fue recibida.
  5. **Recibida** → Toda la mercadería fue recibida.
  6. **Cancelada** → La orden fue anulada.
- **Aprobación con control antidupla** para evitar aprobaciones accidentales duplicadas.
- **Vista detallada** de cada orden con items, cantidades y montos.

**Relación con otros módulos:** Las Órdenes de Compra se vinculan con Proveedores (emisor), Inventario (productos a comprar) y Recepciones (ingreso de la mercadería).

### 3.9 Recepciones de Mercadería

Registro del ingreso físico de mercadería al depósito:

- **Recepción contra OC aprobada:** Se selecciona una orden de compra aprobada y se registra qué productos y cantidades se recibieron efectivamente.
- **Campos de trazabilidad:** Número de lote y fecha de vencimiento para cada item recibido.
- **Aprobación de recepción** que ejecuta automáticamente el ingreso de stock al inventario.
- **Devoluciones a proveedor** para registrar mercadería defectuosa o incorrecta que debe devolverse.
- **Historial completo** de recepciones y devoluciones con fechas y estados.

**Relación con otros módulos:** Las Recepciones toman Órdenes de Compra como base, incrementan el stock en Inventario al aprobar, y registran Devoluciones a Proveedor cuando corresponde.

### 3.10 Facturación

Emisión y gestión de comprobantes fiscales:

- **Tipos de comprobante:** Factura A, Factura B y Comprobante X (consumidor final).
- **Creación manual** de facturas seleccionando cliente, items y montos.
- **Creación automática desde pedido** vinculando la factura al pedido correspondiente.
- **Vista previa del comprobante** antes de su emisión.
- **Impresión de facturas** en formato profesional.
- **Envío por email** del comprobante al cliente.
- **Historial de facturas** con búsqueda, filtrado y estados.

**Relación con otros módulos:** La Facturación se vincula con Pedidos (origen de la factura), Clientes (destinatario), POS (factura de mostrador), Cuentas por Cobrar dentro de la ficha del cliente, y Contabilidad (registro contable).

### 3.11 Gestión de Caja

Control de los flujos de efectivo en las cajas registradoras:

- **Apertura de turno** con monto inicial declarado por el cajero.
- **Cierre de turno** con resumen automático del turno: ventas registradas, cobros por método de pago, y cálculo de saldo esperado vs. saldo real.
- **Múltiples cajas registradoras** con gestión independiente.
- **Ajustes de caja** para registrar diferencias entre el monto esperado y el monto real encontrado.

**Relación con otros módulos:** La Caja se alimenta de las ventas del POS y los cobros de Pedidos. Los datos del turno se reflejan en la Contabilidad.

### 3.12 Contabilidad

Módulo de reporting financiero con visualización de ingresos y egresos:

- **Resumen financiero** con indicadores de ingreso total, egreso total y balance.
- **Gráfico de barras** comparativo de ingresos vs. egresos por período.
- **Indicadores de tendencia** (flechas arriba/abajo) que muestran la evolución respecto al período anterior.
- **Listado de transacciones detalladas** con tipo (venta, gasto, reembolso), monto, fecha y descripción.

**Relación con otros módulos:** La Contabilidad recopila datos de todos los módulos operativos: ventas del POS, cobros de Pedidos, pagos a Proveedores, ajustes de Caja, notas de crédito de Devoluciones, etc.

### 3.13 Devoluciones y Garantías

Módulo de postventa dividido en tres secciones integradas:

**Garantías:**
- Registro de reclamos de garantía con descripción del problema, producto y cliente.
- Flujo: Pendiente → En revisión → Aprobada / Rechazada → Resuelta.
- Actualización de estado con un clic.

**Devoluciones de Cliente:**
- Registro de devoluciones con motivo, productos y monto.
- Aprobación de devolución con reingreso automático de stock al inventario.

**Notas de Crédito:**
- Generación de notas de crédito asociadas a devoluciones aprobadas.
- Listado con número de documento, monto, estado y fecha.

**Relación con otros módulos:** Las Devoluciones reingresan stock al Inventario, generan Notas de Crédito que impactan en la cuenta corriente del Cliente, y se reflejan como movimientos en la Contabilidad.

### 3.14 Login y Control de Acceso (RBAC)

Sistema de autenticación y autorización basado en roles:

- **Autenticación segura** con email y contraseña, utilizando tokens JWT.
- **Cuatro roles predefinidos** con permisos diferenciados:

| Rol | Acceso |
|-----|--------|
| **Admin** | Acceso total a todos los módulos |
| **Manager** | Inventario, Pedidos, Clientes, Compras, Facturación |
| **Cajero (Cashier)** | POS, Pedidos, Clientes, Facturación, Caja |
| **Depósito (Warehouse)** | Inventario, Pedidos (solo picking), Recepciones |

- **Protección de rutas** tanto en frontend (redirección) como en backend (middleware).
- **Pantalla de login profesional** con panel visual descriptivo del sistema.

### 3.15 Configuración del Sistema

Panel de administración accesible solo para administradores:

- **Datos de la empresa:** Nombre comercial, razón social, CUIT, dirección, teléfono, email.
- **Configuración de facturación:** Punto de venta, numeración inicial de facturas.
- **Gestión de usuarios:** Alta, edición, eliminación de usuarios con asignación de roles.
- **Configuraciones del sistema:** Moneda, alícuota de IVA, formato de fecha.
- **Log de auditoría:** Registro cronológico paginado de todas las acciones realizadas por los usuarios del sistema.

---

## 4. Flujos de Trabajo Principales

### 4.1 Flujo de Venta en Mostrador (POS)

```
Cliente llega → Cajero abre POS → Escanea productos → Ajusta cantidades
→ Selecciona cliente (o crea uno nuevo) → Elige medio de pago (o divide)
→ Selecciona tipo de factura → Confirma venta
→ [Stock se descuenta] → [Factura se genera] → [Transacción se registra]
→ [Cta. cte. del cliente se actualiza si corresponde]
```

### 4.2 Flujo de Pedido (Venta → Depósito → Entrega)

```
Vendedor crea pedido → Estado: PENDIENTE
→ Depósito inicia picking → Estado: EN PREPARACIÓN
→ Operario escanea y recolecta items → Confirma picking
→ Estado: EMPAQUETADO (listo para despacho)
→ Logística despacha → Estado: DESPACHADO
→ Cliente recibe → Estado: ENTREGADO
→ Se genera factura desde el pedido
```

### 4.3 Flujo de Compra (Abastecimiento)

```
Manager crea Orden de Compra → Selecciona proveedor y productos
→ OC en estado BORRADOR → Se aprueba internamente → Estado: APROBADA
→ Mercadería llega → Se registra Recepción contra la OC
→ Se ingresan lotes y vencimientos → Se aprueba la recepción
→ [Stock se incrementa automáticamente]
→ Si hay defectuosos → Se registra Devolución a Proveedor
```

### 4.4 Flujo de Devolución de Cliente

```
Cliente reclama → Se registra la devolución (motivo, productos, monto)
→ Estado: PENDIENTE → Se revisa y aprueba → Estado: APROBADA
→ [Stock se reingresa al inventario]
→ Se genera Nota de Crédito → [Saldo de cta. cte. se ajusta]
```

### 4.5 Flujo de Garantía

```
Cliente presenta reclamo → Se registra garantía (producto, descripción)
→ Estado: PENDIENTE → Se inicia revisión → Estado: EN REVISIÓN
→ Se determina resultado → Estado: APROBADA o RECHAZADA
→ Si aprobada → Se resuelve → Estado: RESUELTA
```

### 4.6 Flujo de Caja (Turno)

```
Cajero inicia turno → Declara monto inicial → Caja ABIERTA
→ Se realizan ventas y cobros durante el turno
→ Cajero cierra turno → Sistema calcula saldo esperado
→ Cajero declara monto real → Se registra diferencia si la hay
→ Caja CERRADA → Resumen del turno disponible
```

---

## 5. Relaciones entre Módulos

El sistema opera como un ecosistema integrado donde las acciones en un módulo impactan en otros automáticamente:

```
                        ┌─────────────┐
                        │  Dashboard  │ ←── Datos agregados de todos los módulos
                        └──────┬──────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
    ┌─────▼─────┐      ┌──────▼──────┐     ┌──────▼──────┐
    │    POS    │      │   Pedidos   │     │   Compras   │
    │  (Venta)  │      │  (Órdenes)  │     │  (Abast.)   │
    └─────┬─────┘      └──────┬──────┘     └──────┬──────┘
          │                   │                    │
          │              ┌────▼────┐          ┌────▼────┐
          │              │ Picking │          │Recepción│
          │              └────┬────┘          └────┬────┘
          │                   │                    │
    ┌─────▼───────────────────▼────────────────────▼─────┐
    │                   INVENTARIO                        │
    │              (Stock centralizado)                   │
    └─────┬───────────────────┬────────────────────┬─────┘
          │                   │                    │
    ┌─────▼─────┐      ┌─────▼──────┐     ┌──────▼──────┐
    │ Facturac. │      │  Clientes  │     │Proveedores  │
    └─────┬─────┘      └─────┬──────┘     └──────┬──────┘
          │                  │                    │
    ┌─────▼──────────────────▼────────────────────▼─────┐
    │                 CONTABILIDAD                       │
    │         (Registro financiero unificado)            │
    └───────────────────────┬───────────────────────────┘
                            │
                   ┌────────▼────────┐
                   │  Caja (Turnos)  │
                   └─────────────────┘
```

**Principio de diseño:** Una acción en cualquier punto del sistema (vender, recibir mercadería, devolver un producto, registrar un pago) genera automáticamente los movimientos correspondientes en los módulos relacionados, eliminando la necesidad de doble carga de datos.

---

## 6. Características Técnicas Destacables

- **Aplicación web moderna** (SPA) que funciona en cualquier navegador sin instalación.
- **Backend API REST** con autenticación JWT y middleware de autorización por roles.
- **Base de datos relacional** (MySQL 8) con migraciones automáticas y seeding de datos iniciales.
- **Manejo global de errores** con notificaciones toast amigables para el usuario.
- **Carga diferida (lazy loading)** de módulos para rendimiento óptimo.
- **Validación de datos** tanto en frontend como en backend.
- **Paginación** en listados extensos para manejar grandes volúmenes de datos.
- **Smoke tests automatizados** para validar integridad de datos, RBAC y flujos de negocio.
- **Esquema de monorepo** con separación limpia entre frontend (`@wsm/client`) y backend (`@wsm/server`).

---

## 7. Prestaciones Actuales (Estado de Avance)

| # | Módulo | Estado | Observaciones |
|---|--------|--------|---------------|
| 1 | Dashboard | ✅ Operativo | KPIs en tiempo real desde la base de datos |
| 2 | POS | ✅ Operativo | Venta con escaneo, split payment y facturación |
| 3 | Inventario | ✅ Operativo | CRUD completo con alertas de stock bajo |
| 4 | Pedidos | ✅ Operativo | Flujo completo de 7 estados |
| 5 | Picking | ✅ Operativo | Escaneo de barras, faltantes, orden por ubicación |
| 6 | Clientes | ✅ Operativo | CRM con cuenta corriente y movimientos |
| 7 | Proveedores | ✅ Operativo | CRUD con pagos y cuenta corriente |
| 8 | Órdenes de Compra | ✅ Operativo | Creación, aprobación y seguimiento |
| 9 | Recepciones | ✅ Operativo | Con lote, vencimiento y devoluciones |
| 10 | Facturación | ✅ Operativo | Tipos A, B, X con preview e impresión |
| 11 | Caja | ✅ Operativo | Apertura/cierre de turno con resumen |
| 12 | Contabilidad | ✅ Operativo | Gráficos y transacciones detalladas |
| 13 | Garantías | ✅ Operativo | Flujo completo de estados |
| 14 | Devoluciones | ✅ Operativo | Con reingreso de stock y notas de crédito |
| 15 | Configuración | ✅ Operativo | Empresa, usuarios, auditoría, sistema |

**Todos los módulos están integrados con el backend y la base de datos real (MySQL 8).** No se emplean datos simulados (mocks) en la versión actual.

---

*Documento generado el 23 de febrero de 2026 — WSM SportsERP by Antigravity Systems*
