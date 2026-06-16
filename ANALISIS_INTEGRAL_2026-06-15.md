# Análisis Integral — WSM SportsERP

**Fecha:** 15 de junio de 2026
**Alcance:** FODA, lógica de negocio, UX, coordinación de pantallas, integración AFIP e integración Tienda Nube.
**Enfoque:** mixto técnico + negocio.
**Base revisada:** monorepo `@wsm/{client,common,server}`, migraciones 000–020, servicios de ventas/inventario/AFIP/Tienda Nube, ruteo y documentación de ejecución (`docs/execution/`).

---

## 1. Veredicto rápido

WSM SportsERP es un ERP/POS **sólido y sorprendentemente completo** para retail deportivo: 15 módulos operativos conectados a una base real (MySQL), RBAC de verdad, contabilidad de partida doble, e integraciones AFIP y Tienda Nube que ya existen como código funcional y no como maqueta.

Sin embargo, **no está listo para producción fiscal/comercial todavía**. Hay dos riesgos críticos concretos (un CAE falso de respaldo y credenciales fiscales en texto plano) y las dos integraciones que más te importan están "técnicamente preparadas" pero **no validadas contra entornos reales** y son **unidireccionales y sin reintentos**. La distancia entre "el código existe" y "opera confiable en producción" es real pero acotada.

| Eje | Estado | Lectura corta |
|---|---|---|
| Arquitectura y código | Muy bueno | Monorepo limpio, contratos compartidos, tests y CI. |
| Lógica de negocio | Bueno con grietas | Transacciones correctas; faltan QC bloqueante y aprobación real de OC. |
| UX / coordinación de pantallas | Bueno | Navegación por rol coherente; faltan bandejas de excepción. |
| AFIP | Avanzado pero riesgoso | SDK real + recuperación split-brain; CAE falso de fallback y key en texto plano. |
| **Tienda Nube** | Preparado, no probado | OAuth+webhook+idempotencia OK; sync unidireccional, sin retry, import parcial silencioso. |

> El equipo se autoevalúa en **86/100** (`docs/execution/STATE.md`). Es una estimación honesta de *madurez de código*; mi lectura de *madurez de producción* es más baja hasta cerrar los dos riesgos críticos y validar las integraciones end-to-end.

---

## 2. Fortalezas

**Arquitectura.** Monorepo con separación nítida (`packages/client` React/Vite, `packages/server` Node/Express, `packages/common` con esquemas Zod compartidos). Esto evita la divergencia de contratos entre front y back, que es la causa #1 de bugs en ERPs caseros.

**Seguridad de acceso (defensa en profundidad).** RBAC aplicado en **ambos** lados: en el front cada ruta está envuelta en `ProtectedRoute` con `allowedRoles` (`App.tsx`) y en el back hay middleware de autenticación/autorización. JWT con expiración, rate-limiting diferenciado para login vs API general, política de contraseñas y `token_version` para invalidación (migración 003).

**Integridad transaccional.** Las operaciones sensibles usan transacciones con rollback: la venta del POS, la recepción que mueve stock, la autorización de factura que además genera el asiento contable. El POS aplica UI optimista con rollback si la venta falla.

**Contabilidad de verdad.** No es un "resumen de caja": hay partida doble con asientos balanceados, plan de cuentas, cuentas de IVA débito fiscal y autoajuste de redondeo (`sales.service.js`, módulo `accounting`). Para un retail esto es diferencial real.

**AFIP con lógica anti-fallos.** El servicio usa el SDK oficial `@afipsdk/afip.js`, soporta homologación/producción, y —destacable— implementa **recuperación de "split-brain"**: si se pierde la respuesta de AFIP, consulta el último comprobante emitido y, si coincide monto y documento, lo recupera en lugar de duplicar (`sales.service.js:1257–1281`). Es un patrón maduro que mucha competencia no tiene.

**Tienda Nube con prácticas correctas de integración.** OAuth con `state` firmado por HMAC y con expiración (`tiendanube.service.js:42–79`), verificación HMAC del webhook (`verifyWebhookSignature`), **idempotencia** vía tabla `tiendanube_webhook_events` con detección de duplicados, procesamiento asíncrono del webhook (responde 200 rápido y procesa en `setImmediate`), versión de API actual (`2025-03`) y uso del endpoint oficial de stock por variante.

**Calidad y disciplina de proceso.** Tests unitarios de back y front, smoke tests de RBAC e integridad, workflow de CI (`.github/`), migraciones versionadas e incrementales (000→020), y una **documentación de ejecución excepcional** (`BITACORA_INTEGRAL.md`, `STATE.md`, `CHANGELOG_EXECUTION.md`, `HANDOFF.md`) con autocrítica honesta. Esta trazabilidad de decisiones es rara en proyectos de este tamaño y reduce muchísimo el riesgo de continuidad.

**Rendimiento de front.** Lazy loading de todas las páginas, paginación en listados, React Query con `staleTime`/`gcTime` y manejo global de errores con toasts.

---

## 3. Debilidades (con foco en lo accionable)

### 3.1 Críticas

**(C1) CAE de respaldo falso.** En `sales.service.js:1292` (y duplicado en `warranties.service.js:478`):

```js
const cae = afipRes ? afipRes.cae : String(Math.floor(10000000000000 + Math.random() * 90000000000000));
```

Cuando no hay respuesta de AFIP (hoy solo cuando `invoice_type === 'TK'`), se escribe un **número aleatorio de 14 dígitos en el campo `cae`** y una fecha de vencimiento a +10 días inventada. Si un comprobante con ese "CAE" llega a imprimirse como si fuera fiscal, es un problema fiscal y legal serio. Aun si "TK" es un ticket no fiscal, **guardar un valor con forma de CAE real es peligroso**: hay que dejar el campo nulo/explícito ("SIN CAE") y nunca un número que parezca autorizado por AFIP.

**(C2) Credenciales fiscales y de e-commerce en texto plano.** El certificado AFIP (`billing_afip_crt`), la **clave privada** (`billing_afip_key`), el `tiendanube_client_secret` y el `tiendanube_access_token` se guardan como `TEXT` plano en `company_settings` (migración 010; no hay cifrado en ningún punto del back). Además, la clave AFIP se **escribe en el directorio temporal del SO en texto plano y no se borra** (`afip.service.js:39–40`). La clave privada de AFIP permite **facturar en nombre del CUIT**: su exposición es el peor escenario. Hay redacción en el perfil público (`settingsController` con `includeSecrets`), pero eso protege la *respuesta de la API*, no el *almacenamiento*.

### 3.2 Altas

**(A1) Tienda Nube importa órdenes parciales en silencio.** En `importOrderPayload` (`tiendanube.service.js:197–215`) solo se agregan los ítems cuyo SKU existe localmente; los que no matchean se descartan sin alerta. Una orden de 3 productos con 1 SKU no mapeado entra como orden de 2 productos → **totales, stock descontado y preparación quedan incompletos** y nadie se entera. Falta una bandeja de "órdenes con ítems sin vincular" / cuarentena.

**(A2) Integraciones unidireccionales y sin reintento.** `syncStock` es "fire-and-forget": ante un fallo, **traga el error** (`tiendanube.service.js:320–324`, comentado: *"could save to a failed_syncs table for retry"* — no implementado). No hay reconciliación de vuelta a Tienda Nube (estado de envío/cumplimiento), ni sync de precios, ni alta de productos. Si una sincronización de stock falla, **el ERP y la tienda divergen en silencio**.

**(A3) Costo de la sincronización de stock.** `syncStock` se dispara tras cada movimiento de inventario y, para conocer el stock, llama a `getInventoryWithDetails()` (trae **todo** el inventario) y luego busca el producto (`inventory.service.js:241–252`). Es O(N) por movimiento; con catálogo grande y alta rotación, se nota.

**(A4) Lógica de compras simplificada.** "Aprobar" una OC en realidad la pasa a `sent` (lo reconoce la propia review del equipo). No hay solicitud interna/OT ni aprobación separada de envío, y el control de calidad **no es bloqueante**: mercadería defectuosa puede entrar como stock disponible antes del control.

### 3.3 Medias

**(M1) Lógica de autorización AFIP duplicada** entre `sales.service.js` y `warranties.service.js` (incluido el bug del CAE falso): cualquier corrección hay que hacerla en dos lugares → riesgo de divergencia.

**(M2) Faltan bandejas de excepción** para "factura POS fallida luego de venta guardada" y "stock pendiente de calidad". (Cobranzas, Cuentas Corrientes y Pagos a Proveedores **ya existen** como pantallas, lo cual cierra parte de la deuda previa.)

**(M3) Webhooks de Tienda Nube se registran a mano.** No hay código que los registre automáticamente vía API al conectar la tienda; queda como paso manual propenso a olvido.

**(M4) Higiene de repo.** Snapshots de recuperación (`recovery-snapshot-*.zip`), scripts `scratch/` y `legacy/`, y logs versionados conviven con el código productivo.

---

## 4. Oportunidades

**AFIP (completar el círculo fiscal argentino):**
- **QR obligatorio** en comprobantes (RG 4892) y leyenda fiscal completa.
- **Consulta de padrón** (constancia de inscripción) para autocompletar condición frente al IVA del cliente y elegir A/B automáticamente.
- **CAEA** (autorización por lote / contingencia) para no depender del CAE online en tiempo real.
- Cobertura plena de **notas de crédito/débito** y, a futuro, **FCE MiPyME**.

**Tienda Nube (de "espejo de stock" a integración real):**
- **Bidireccionalidad**: empujar a TN estado de envío/tracking y precios; crear productos desde el ERP.
- **Cola `failed_syncs` con reintentos** y tablero de reconciliación ERP↔TN↔AFIP.
- **Auto-vinculación por SKU** (hoy el ID de producto/variante TN se tipea a mano por fila en el gestor de catálogo: tedioso para catálogos grandes).
- **Registro automático de webhooks** al conectar.
- Base lista para **multicanal** (sumar Mercado Libre con el mismo patrón de adaptador).

**Seguridad / plataforma:**
- Cifrado de secretos en reposo (KMS o libsodium) y manejo de la key AFIP sin texto plano en disco.
- Multi-sucursal / multi-punto-de-venta y multi-moneda (hoy `MonId: 'PES'` está fijo).

**Producto / negocio:**
- App móvil de picking y etiquetado con integración a transportistas.
- Reportería/BI sobre la contabilidad ya estructurada (margen por producto/categoría, rotación, ABC).

---

## 5. Análisis de lógica

Lo que **está bien pensado**: el flujo POS valida caja abierta, carrito no vacío y que los medios de pago sumen exactamente el total; la venta es transaccional con rollback; la recepción mueve stock dentro de transacción; los pedidos separan preparación de facturación; la facturación desde pedido emite **sin** cobro automático y deja el saldo en cuenta corriente (decisión contable correcta); y la autorización AFIP genera el asiento de venta balanceado con IVA. La recuperación split-brain de AFIP es lógica de nivel profesional.

Lo que **falla o simplifica**: (1) el CAE falso de fallback (C1) es un defecto de lógica fiscal; (2) la importación parcial silenciosa de TN (A1) rompe la integridad orden↔stock↔factura; (3) "aprobar = enviar" en compras (A4) confunde responsabilidades; (4) calidad no bloquea el stock disponible; (5) la duplicación de la lógica AFIP (M1) invita a que las dos copias se desincronicen.

---

## 6. UX de usuarios

**Aciertos.** El sidebar agrupa por área funcional y **filtra ítems por rol** (`AppLayout.tsx`), de modo que cada perfil ve solo lo suyo. El POS vive **fuera del layout general** (pantalla completa tipo terminal, `App.tsx`): decisión correcta para mostrador. Hay estados de carga (skeletons/loaders), toasts de error globales, UI optimista en POS y se corrigió que la ruta padre quede activa en rutas hijas (ej. `/clients/:id`).

**Fricciones.** (1) Faltan **bandejas de excepción** que conviertan errores en trabajo visible (factura POS fallida, stock pendiente de QC, órdenes TN con ítems sin vincular). (2) La **configuración de Tienda Nube es manual y artesanal**: en el "Gestor de Vinculación" hay que cargar a mano `TN Product ID` y `TN Variant ID` por cada producto, sin auto-match por SKU ni vinculación masiva. (3) Persisten ajustes de copy/encoding que el equipo viene limpiando incrementalmente.

---

## 7. Coordinación entre pantallas y vínculos

La integración entre pantallas es uno de los puntos fuertes y se sostiene en tres mecanismos:

1. **Cascada de datos en el back.** Una acción dispara los movimientos relacionados sin doble carga: vender en POS descuenta inventario → genera asiento contable → dispara sync a Tienda Nube → actualiza cuenta corriente si aplica. Recepción aprobada incrementa stock; devolución aprobada lo reingresa y genera nota de crédito que ajusta el saldo del cliente.

2. **Flujo de pedido encadenado entre roles/pantallas.** Pedido → Picking (`/picking/:id`) → Empaquetado → Despacho → Entrega → Factura → Cobranza, cada etapa visible para el rol correspondiente.

3. **Coordinación de caché en el front.** React Query con `queryKeys` centralizados sincroniza vistas tras cada mutación, de modo que (por ejemplo) Pedidos refleje el estado post-picking sin recargar.

**Punto débil de coordinación:** el puente ERP↔Tienda Nube es el eslabón menos robusto (unidireccional, sin reintento ni reconciliación visible — ver A1/A2), justo el vínculo más expuesto a divergencia silenciosa.

---

## 8. Pretensiones de conexión: AFIP

**Qué pretende ser:** facturación electrónica argentina real (A/B/C y notas de crédito), por empresa/CUIT, con certificado propio, alternando homologación y producción desde la configuración.

**Qué hay hoy (real):**
- Servicio funcional con SDK oficial, cálculo de neto/IVA por alícuota (21 / 10,5 / 0), armado del payload `FECAESolicitar`, obtención de `CAE` y vencimiento, y consulta de último comprobante.
- **Cableado de verdad** al flujo: `authorizeInvoice` llama a AFIP para todo lo que no sea ticket (`sales.service.js:1254–1289`).
- Recuperación split-brain (anti-duplicado).

**Brechas para producción:**
- **C1 (CAE falso)** y **C2 (key en texto plano + en tmp)** — bloqueantes.
- Falta **QR fiscal** obligatorio, **consulta de padrón**, **CAEA**, y `MonId` está fijo en pesos.
- Falta validación end-to-end contra homologación con un CUIT real y juego de pruebas de tipos de comprobante.

**Lectura:** la pretensión AFIP es **realista y está bien encaminada** (la parte difícil —SDK, IVA, anti-duplicado— está hecha), pero requiere cerrar los dos riesgos críticos y agregar QR/padrón antes de emitir en producción.

---

## 9. Pretensiones de conexión: Tienda Nube (lo más importante)

**Qué pretende ser:** conexión OAuth a una tienda real, ingreso automático de órdenes de la tienda al ERP (vía webhook + sync manual de respaldo) y **espejo de stock** del ERP hacia Tienda Nube.

**Qué hay hoy (real):**

| Capacidad | Estado | Evidencia |
|---|---|---|
| OAuth (authorize + callback) | Implementado, con `state` firmado HMAC | `integrationController.js:8–69`, `tiendanube.service.js:42–79` |
| Webhook de órdenes | Implementado, con verificación HMAC, 200 inmediato y proceso async | `integrationController.js:71–97` |
| Idempotencia de webhook | Implementado (tabla `tiendanube_webhook_events`) | `tiendanube.service.js:112–137` |
| Import de orden TN → pedido ERP | Implementado, **match por SKU** | `tiendanube.service.js:179–231` |
| Sync de stock ERP → TN | Implementado, **unidireccional, sin retry** | `inventory.service.js:241–252`, `tiendanube.service.js:277–325` |
| Sync manual de respaldo (30 últimas) | Implementado | `tiendanube.service.js:327–393` |
| Gestor de vinculación de catálogo (UI) | Implementado, **carga manual de IDs** | `TiendanubeSettingsTab.tsx` |
| Reconciliación TN→ERP (envío/cumplimiento) | **No existe** | — |
| Sync de precios / alta de productos | **No existe** | — |
| Cola de reintentos `failed_syncs` | **No existe** (solo comentada) | `tiendanube.service.js:323` |
| Registro automático de webhooks | **No existe** (manual) | — |

**Pendientes que el propio equipo declara antes de probar con tienda real** (`BITACORA_INTEGRAL.md` §19): backend publicado por **HTTPS** (Tienda Nube no acepta `localhost` para webhooks), cargar `Client ID`/`Secret` en Configuración → Tienda Nube, y registrar las URLs de callback/webhook en el panel de Tienda Nube.

**Riesgos específicos a vigilar:**
1. **Import parcial silencioso (A1):** el mayor riesgo de integridad. Una orden con un SKU no mapeado entra incompleta.
2. **Divergencia de stock (A2/A3):** sin reintento ni reconciliación, un fallo de red deja stocks distintos en ERP y TN sin alarma.
3. **Vinculación manual de catálogo:** propensa a error humano (IDs tipeados) y no escalable; conviene auto-resolver por SKU contra la API de TN.

**Lectura:** Tienda Nube está **"technically ready" pero no probado en real y todavía a media máquina** (un solo sentido, sin red de seguridad). La base de seguridad (OAuth firmado, HMAC, idempotencia) es la parte más difícil y **está bien hecha**; lo que falta es robustez operativa (retry/reconciliación/auto-match) y la validación contra una tienda HTTPS real.

---

## 10. Recomendaciones priorizadas

**P0 — Bloqueantes antes de producción**
1. Eliminar el CAE aleatorio de fallback (C1) en `sales.service.js` y `warranties.service.js`; dejar `cae = NULL`/estado explícito y unificar la lógica en un solo módulo (M1).
2. Cifrar secretos en reposo y dejar de escribir la key AFIP en `tmp` en texto plano (C2).
3. Validar AFIP end-to-end en homologación con CUIT real; validar OAuth+webhook de Tienda Nube contra una URL HTTPS de staging.

**P1 — Robustez de las integraciones**
4. Bandeja de "órdenes TN con ítems sin vincular" + no importar parcial en silencio (A1).
5. Cola `failed_syncs` con reintentos para `syncStock` y reconciliación ERP↔TN (A2).
6. Optimizar `syncStock` para no traer todo el inventario por movimiento (A3).
7. QR fiscal y consulta de padrón en AFIP.

**P2 — Madurez operativa**
8. Aprobación real de OC separada de "enviar" + QC bloqueante antes de stock disponible (A4).
9. Bandejas de excepción de factura POS fallida y stock pendiente de calidad (M2).
10. Auto-vinculación de catálogo por SKU y registro automático de webhooks (M3) + higiene de repo (M4).

---

*Análisis preparado sobre el estado del repositorio al 15/06/2026. Las referencias a archivo/línea corresponden a esa instantánea.*
