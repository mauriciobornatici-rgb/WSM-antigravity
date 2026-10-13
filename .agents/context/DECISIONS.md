# Decision Log — WSM SportsERP (ADR)

Este registro documenta las decisiones estructurales y de arquitectura que condicionan el desarrollo del proyecto.

---

### ADR-001 — Monorepo con npm workspaces y contratos compartidos en @wsm/common
- **Fecha:** 2026-06-01
- **Estado:** accepted
- **Contexto:** Necesidad de sincronizar tipos TypeScript, DTOs y matriz de capacidades RBAC entre backend y frontend sin duplicación de código.
- **Decisión:** Utilizar monorepo estructurado con `@wsm/client` (React/Vite), `@wsm/server` (Express/Node) y `@wsm/common` (tipos e interfaces).
- **Consecuencias:** Todo cambio en tipos compartidos exige reconstruir `@wsm/common` (`npm run build:common`).

---

### ADR-002 — Autenticación robusta con JWT en cookies HttpOnly
- **Fecha:** 2026-08-19
- **Estado:** accepted
- **Contexto:** Mitigar riesgos de XSS derivados del almacenamiento de tokens en `localStorage`.
- **Decisión:** Migrar el almacenamiento de JWT a cookies `HttpOnly`, `SameSite=Strict`, `Secure` gestionadas exclusivamente por el backend con control de `token_version` para revocación instantánea.
- **Consecuencias:** El cliente web no lee el token directamente; las peticiones utilizan `credentials: 'include'`.

---

### ADR-003 — Libro mayor contable inmutable y contra-asientos
- **Fecha:** 2026-08-19
- **Estado:** accepted
- **Contexto:** Garantizar trazabilidad y cumplimiento contable/auditoría sin riesgo de borrado accidental de transacciones financieras.
- **Decisión:** Bloquear operaciones `DELETE` o `UPDATE` sobre asientos confirmados; cualquier anulación o ajuste se ejecuta mediante contra-asiento formal.
- **Consecuencias:** Integridad transaccional 100% auditable y reproducible.

---

### ADR-004 — Conteo cíclico móvil en modalidad ciega y segregación de funciones
- **Fecha:** 2026-08-22
- **Estado:** accepted
- **Contexto:** Evitar sesgos en la toma de inventario físico en bodega y garantizar control interno.
- **Decisión:** El backend no entrega stock teórico ni desvíos durante la sesión de conteo. Los operarios solo registran lo observado físicamente. La aprobación de diferencias queda reservada a roles administrativos o gerencia.
- **Consecuencias:** Auditorías de stock fiables y trazables por SKU y ubicación física.

---

### ADR-005 — Marco de Gobernanza y Mejores Prácticas con Google Antigravity
- **Fecha:** 2026-09-02
- **Estado:** accepted
- **Contexto:** Estandarizar la interacción de agentes de IA con el monorepo para evitar pérdidas de contexto, regresiones y consumo desmedido de tokens.
- **Decisión:** Adoptar la arquitectura oficial de Antigravity con `GEMINI.md` en la raíz, capa `.agents/context/`, contrato de calidad determinista en `QUALITY.md` y normalización de plugins/skills de ingeniería.
- **Consecuencias:** Trabajo continuo, verificable y compatible con las herramientas avanzadas de Antigravity.

---

### ADR-006 — Adaptación selectiva de Base Codex a la memoria existente
- **Fecha:** 2026-09-06
- **Estado:** accepted (documentación dentro del alcance solicitado)
- **Contexto:** Dos memorias divergentes y snapshots extensos dificultaban retomar el trabajo.
- **Decisión:** Conservar AGENTS/GEMINI y .agents/context como fuentes vigentes; usar .ai como referencias de compatibilidad; archivar el historial antes de resumirlo. Incorporar mapas de arquitectura/riesgos/evidencia y perfiles de lectura adaptados de Base Codex.
- **Evidencia:** [Informe](../../docs/execution/ANALISIS_APP_Y_BASE_CODEX_2026-09-06.md), scripts reales y gates ejecutados.
- **Consecuencias:** Menos duplicación del estado activo; el modelo/esfuerzo de agentes se hereda. No se modifica la autoridad de las reglas existentes ni se exige delegación automática.
- **Reversión:** [Copias previas](../../docs/execution/archive/base-codex-2026-09-06/README.md); restaurar solo documentos de esta adaptación, preservando cambios funcionales previos.
- **Sustituye a:** Ninguna decisión de dominio; complementa ADR-005 para compatibilidad con Codex.

---

### ADR-007 — Capa de control Claude Code adaptada de Base Claude
- **Fecha:** 2026-09-25
- **Estado:** accepted (pedido explícito del usuario)
- **Decisión:** Instalar `.claude/` (settings, hooks, 8 agentes, 5 skills) apuntando a `.agents/context/` como único estado; no crear un `.ai/ESTADO.md` paralelo. `CLAUDE.md` importa `TASKS.md`. Modelo por agente según riesgo: haiku (explorador), sonnet (implementador, verificador, revisor-ux), opus (planificador, auditor-externo, revisor-seguridad, guardian-integridad).
- **Consecuencias:** Bitácora local (`.agents/context/BITACORA.md`, gitignored) escrita por hook; la puerta Stop exige checkpoint; los scripts que tocan la DB configurada quedan en `ask`.

### ADR-008 — Decisiones de negocio del usuario
- **Fecha:** 2026-09-25
- **Precio POS:** el servidor usa el precio de catálogo; solo un permiso nuevo `ORDERS_PRICE_OVERRIDE` permite cambiarlo, con auditoría de cada cambio.
- **IVA (corregido tras verificar el POS):** `sale_price` es **neto**; el POS cobra neto + IVA y eso es correcto. Se unifica el mismo cálculo en cliente, servidor y ARCA (`afip.service` hoy lo trata como final). La primera respuesta ("incluye IVA") quedó sin efecto.
- **Venta offline:** al sincronizar se respeta el precio capturado y, si el turno se cerró, se asigna al turno abierto actual; todo con auditoría.
- **Reparación, pedidos POS sin factura ni pago:** solo se listan; `--cancel-unpaid` libera su reserva a pedido.
- **Tiendanube entregado/cerrado sin picking local:** se consume la reserva y queda movimiento `sale`.
- **Permiso `ORDERS_PRICE_OVERRIDE`:** admin y manager; no cajero ni depósito.
- **Stock histórico:** las ventas POS nunca descontaron stock físico. Se corrige el código y se entregan scripts de diagnóstico y reparación (dry-run, probados en QA); el usuario decide si y cuándo correrlos en producción.
- **Asiento de compras:** solo la factura del proveedor genera el asiento (Mercadería + IVA CF / Proveedores); la aprobación de la recepción mueve stock sin asentar.
- **DB remota:** en desarrollo el servidor rechaza un `DB_HOST` no local salvo `ALLOW_REMOTE_DB=true`.
- **Migraciones nuevas:** permitidas, probadas únicamente en `wsm_qa` (127.0.0.1:33308); las históricas no se editan.

### ADR-018 — Respuestas del usuario a lo pendiente de ADR-017 (usuario, 2026-10-12)
1. **Stock inicial con costo obligatorio:** el alta con stock exige precio de compra, en el producto y en la familia de Tienda online. Lo importado de Tiendanube conserva el costo que informe la tienda.
2. **Contrapartida del stock inicial:** cuenta de ajuste 3.1.03.01 "Ajuste por inventario inicial" (patrimonio, migración 055), no Capital.
3. **Envío, según las normas habituales:**
   - Cualquier vendedor puede cobrarlo.
   - Bonificarlo (absorberlo), cambiar su IVA o editarlo después de creado el pedido es una concesión comercial: requiere gerente o administrador (`ORDERS_PRICE_OVERRIDE`, el mismo permiso que cambiar precios) y queda auditado.
4. **Bonificar solo el envío, sin productos:** por ahora no.
5. **NC anulada:** si la NC de una devolución se anula o se borra, su envío deja de contar como devuelto. No hay acción de anular NC: fiscalmente, una NC autorizada se revierte con nota de débito.

### ADR-017 — Envío cobrado o no, bonificación en devoluciones, compras con varias alícuotas (usuario, 2026-10-12)
- **Envío:**
  - Lo contrata y lo paga el negocio. En cada pedido propio se elige cobrárselo al cliente o absorberlo.
  - El envío absorbido queda registrado en el pedido (`order_adjustments.billable = 0`) pero no se factura.
  - El IVA es siempre 21 %, con un selector preparado para excepciones.
  - Se puede editar antes de facturar, solo en pedidos propios y sin pagos registrados (`PUT /orders/:id/shipping`).
  - La factura del transportista se carga como compra de tipo "Fletes y envíos" (5.1.02.06).
- **Bonificación del envío en devoluciones:**
  - Es una casilla por devolución (decisión comercial).
  - Si se marca, la NC incluye lo que quede del envío cobrado (envío menos descuento de envío, una sola vez por pedido) y entra en todo el circuito: NC, asiento con IVA por alícuota, cuenta corriente y ARCA.
- **Envío parcial con acuerdo del cliente:** el envío se cobra completo.
- **Compras:**
  - Una factura puede tener varias alícuotas (`supplier_invoice_vat_lines`), con una línea de crédito fiscal por alícuota.
  - Puede ser de mercadería, fletes u otros gastos.
  - La devolución a proveedor revierte el crédito en las mismas cuentas, proporcionalmente, y solo considera facturas de mercadería.
- **Script de precios de Tiendanube:**
  - No adivina. Usa el origen registrado (`products.origin`, nuevo) o la fecha de creación en Tiendanube (lectura).
  - Si Tiendanube no responde, el producto queda "sin verificar" y no se toca.
- **Aplicación (coordinador, en el camino):**
  - La alícuota del producto ahora se puede elegir (antes no se podía cambiar del 21 %).
  - El stock inicial de un producto, de una familia de Tienda online o de una importación deja movimiento y asiento (Inventario / Capital). El motivo del movimiento quedó en español.

### ADR-016 — Banco, alícuotas, envío y descuentos en la factura, devoluciones exactas (usuario, 2026-10-12)
- **Saldo inicial de Caja 2:** solo el administrador (403 para cualquier otro rol).
- **Banco:**
  - Se lleva el saldo y los movimientos de 1.1.02.01 (pestaña Contabilidad › Banco).
  - Los débitos del banco se registran sueltos o dentro del movimiento (traspasos con el banco, acreditación de tarjetas): comisión, mantenimiento y otros (con IVA crédito fiscal a la alícuota elegida), impuesto a los débitos y créditos (5.1.02.05), y retenciones y percepciones (1.1.05.04).
  - El saldo negativo se avisa pero no se bloquea (descubierto).
- **Gerente:** ve el saldo y los movimientos de Caja 2 (permiso `treasury.read`). Mover dinero sigue siendo de contabilidad.
- **Alícuotas:**
  - Tabla `vat_rates` editable en Configuración, limitada a las alícuotas de ARCA. 21 % es la alícuota por defecto; 0 significa que el IVA no es computable.
  - La comisión de tarjeta usa la alícuota elegida.
  - El IVA se asienta por alícuota (cuentas de 2,5/5/10,5/21/27 %). La factura C no asienta IVA débito.
- **Envío y descuentos de canales (Tiendanube):**
  - Se guardan como ajustes del pedido (`order_adjustments`) y van a la factura como líneas junto al detalle, así la factura suma lo que pagó el cliente.
  - El descuento se reparte por alícuota en proporción a los productos.
- **Datos previos (no estamos en producción):**
  - La migración 052 deja el total de los pedidos internos con IVA (el de la factura si está facturado; si no, el de sus líneas).
  - Los precios importados de Tiendanube antes de ADR-015 se corrigen con `scripts/repair-tiendanube-prices.js`, que primero simula y deja auditoría.
- **Devoluciones parciales:**
  - Cada producto devuelve su parte acumulada de lo cobrado: la unidad k de Q devuelve round(G·k/Q) − round(G·(k−1)/Q).
  - Devolver todo, de a una o junto, suma exactamente lo facturado, descuentos incluidos.
  - Lo devuelto por línea se guarda y la NC en ARCA usa esos importes.
- **Aplicación (coordinador, en el camino):**
  - El CMV se toma del costo de los movimientos de venta, el mismo que revierte una devolución.
  - Compras: solo la factura A o M da crédito fiscal, en la cuenta de su alícuota. En B y C, el IVA es costo. Las percepciones van a 1.1.05.04, no a mercadería.
  - Un total de factura de compra que no coincide con sus partes se rechaza: antes dejaba un asiento descuadrado.
  - La acreditación de tarjetas lee el saldo pendiente con lock.

### ADR-015 — Precio final con IVA, Caja 2, idempotencia y salón de ventas (usuario, 2026-10-12)
- **Precios con IVA en pantalla, guardados netos (amplía ADR-008):**
  - Todo precio o costo visible se muestra con IVA incluido; el IVA se discrimina solo donde es fiscal (factura A, resumen fiscal del carrito, factura de proveedor, libro IVA).
  - El precio de venta se carga final; el costo se carga neto (factura del proveedor) con el final al lado.
  - Para que el precio final se cobre exacto, el neto se guarda con 4 decimales (migración 050).
  - Fórmula única por línea: bruto = round2(cant × neto × (1+r)) primero, IVA = bruto − neto (`utils/vatMath.js`, `client/lib/pricing.ts`).
  - El total de un pedido interno lo calcula siempre el servidor con IVA.
  - Tiendanube publica el precio final y lo importado se guarda neto.
- **Comisión de tarjetas:** se separa el IVA como crédito fiscal (1.1.05.02).
- **Caja 2 (tesorería, 1.1.01.02, migración 049):**
  - Efectivo fuera del cajón. Recibe traspasos desde la caja, el banco o un saldo inicial, y paga proveedores ("Efectivo Caja 2").
  - Nunca se gasta más de lo que tiene (con lock).
  - Los traspasos con la caja del turno usan `transfer_out` / `transfer_in` en el arqueo.
- **Idempotencia:** pagos a proveedor (simple y masivo) y traspasos de tesorería. Tabla `idempotency_requests`: el reintento devuelve la respuesta original y la misma clave con otro contenido da 409.
- **Ubicaciones:** marca "Salón de ventas" (`is_sales_floor`). El mostrador vende primero del salón; los pedidos se preparan primero desde el depósito.
- **Aplicación (coordinador, tras la revisión del guardián, AUD-004):**
  - Un precio pedido a medio centavo del catálogo es el del catálogo (se guardan sus 4 decimales); un precio distinto se guarda a 4 decimales.
  - Una venta offline encolada antes de este cambio puede diferir hasta 1 centavo por línea, porque redondeaba el IVA sobre el total. El último pago absorbe esa diferencia, con auditoría `OFFLINE_SALE_PAYMENT_ROUNDING`, y el mismo monto va a la caja y a la factura. En línea sigue rechazándose.
  - Orden de locks: Caja 2 antes que el turno de caja. Los saldos de Caja 2 y del cajón se leen con lock, nunca de una foto vieja de la transacción.
  - La clave de idempotencia es obligatoria en traspasos de tesorería y se valida (texto de 64 caracteres o menos) en los pagos masivos.

### ADR-014 — NC fiscal, efectivo desde la caja, garantías y tarjetas (usuario, 2026-10-12)
- **NC:**
  - Corrige una factura concreta del mismo cliente. Nunca supera lo acreditable de esa factura, sumando NC manuales y de devolución; las dos bloquean la factura.
  - Toma la letra y la proporción de IVA de la factura.
  - Se autoriza en ARCA con `CbtesAsoc` y la letra de la factura. Sin factura, o con factura sin CAE → 409. Factura TK → autorización local.
  - La recuperación de una respuesta perdida de ARCA exige la misma factura asociada.
  - La factura autorizada guarda el punto de venta real.
  - No hay NC manual de tipo "devolución", ni NC sobre facturas anuladas.
  - Migración 047 (`credit_notes.invoice_id`) y 048 (completa las NC de devolución viejas).
- **Pago a proveedor en efectivo:** sale de una caja abierta, con un solo registro y sin doble asiento. Si hay más de una caja abierta, el usuario elige cuál; se exige efectivo suficiente.
- **Garantías:**
  - La unidad defectuosa entra a Cuarentena (Inventario / Costo de garantías 5.1.02.03) y pasa a "Devoluciones a Proveedores" al enviarla.
  - Rechazada por el proveedor, garantía rechazada o reparada (unidad devuelta al cliente) → baja al costo del ingreso.
  - Reembolsada o reemplazada → la unidad queda nuestra.
  - El reemplazo se imputa a Costo de garantías. La devolución a proveedor toma primero de "Devoluciones a Proveedores".
- **Tarjetas:** acreditación Banco neto + Comisiones (5.1.02.04) / Tarjetas y QR a cobrar, nunca mayor que lo pendiente e idempotente (pestaña Contabilidad › Tarjetas).

### ADR-013 — Contabilidad completa de pagos, caja, ajustes y devoluciones (usuario, 2026-10-12)
El usuario aprobó corregir lo que encontró la simulación operativa. Desde ahora toda operación que mueve dinero o stock deja asiento.
- **Medios de pago:** un solo mapa medio de pago → cuenta (`utils/paymentAccounts.js`). Tarjeta y QR van a "Tarjetas y QR a cobrar" (1.1.02.03, migración 046), no a Caja.
- **Asientos nuevos:**
  - Pago a proveedor desde "Proveedores": Proveedores / Banco o Caja.
  - NC manual: Ventas + IVA DF / Deudores.
  - Ajuste por conteo, al costo: faltante neto Pérdidas / Inventario; sobrante a la inversa.
  - Reintegro: Deudores / medio de pago, y además baja el saldo a favor del cliente.
  - Egreso: Gastos / Caja. Ingreso: Caja / Otros ingresos.
  - Devolución de cliente: revierte el CMV al costo de la venta (Inventario por lo reingresado, Pérdidas por la merma).
- **Garantía resuelta con reemplazo:** descuenta una unidad (una sola vez, por el hecho registrado) y asienta Gastos / Inventario.
- **Stock:**
  - La devolución vendible vuelve a la ubicación de la venta.
  - Los movimientos de venta guardan el costo unitario.
  - El saldo del proveedor no se recorta a 0 (ADR-011).
- **Rechazos (409/400):** una NC manual sobre una devolución que ya tiene su NC, y un reintegro, egreso o ingreso "a cuenta corriente".

### ADR-012 — Reglas de negocio de la revisión del refactor (usuario, 2026-10-12)
- **Estados de orden de compra (cambio manual):** solo hacia adelante: borrador → enviada → parcial → recibida; cancelar solo antes de recibir algo (borrador o enviada). `recibida` y `cancelada` son finales. Otra transición → 409.
- **NC manual idempotente:** el formulario envía una clave única por intento; un reintento con la misma clave devuelve la NC ya emitida. Requiere la migración 045 (`credit_notes.idempotency_key` único); la migración del CHECK de inventario pasa a ser la 056 (046-055 agregan cuentas, NC fiscal, tesorería e idempotencia, precios a 4 decimales, débitos bancarios, alícuotas y ajustes de pedido, y corrigen totales previos; ADR-013/014/015/016).
- **Aplicación (coordinador, tras la revisión del guardián):**
  - "Recibir algo" incluye la mercadería en control de calidad: una OC con recepciones `pending_qc` o cantidades recibidas no se puede anular (409 `purchase_order_has_receptions`). La UI oculta "Anular orden" en ese caso.
  - Aprobar una recepción bloquea la OC antes que sus ítems. Contra una OC anulada responde 409 (`purchase_order_cancelled`), y nunca hace retroceder una OC `received`.
  - Una clave de NC reusada con otro cliente, monto o referencia se rechaza con 409 (`idempotency_key_reused`, informa el número ya emitido) en vez de devolverse como replay. El formulario rota la clave en ese caso y avisa cuando la respuesta es un replay.

### ADR-011 — Cierre de decisiones abiertas (usuario, 2026-10-12)
- **Excepción offline declarada por el cliente:** riesgo aceptado. No hay forma técnica de probar que una terminal estuvo sin red; el control es la revisión obligatoria en "Excepciones POS", con aviso visible al gerente cuando hay pendientes.
- **Devolución a proveedor:** espeja la factura de compra: Proveedores (bruto) / Mercadería (neto) + IVA crédito fiscal; el saldo del proveedor puede quedar a favor (sin recorte a 0).
- **Remoto:** push de `codex/hardening-100` y Pull Request a `main`; no se mergea sin aprobación del usuario.

### ADR-010 — Decisiones tras la auditoría AUD-001 (usuario, 2026-09-25)
- **Precio de venta offline distinto al catálogo:** la venta se registra (ya ocurrió) pero queda como excepción pendiente de revisión de un gerente (permiso `ORDERS_PRICE_OVERRIDE`), visible en un listado.
- **Venta offline sin stock al sincronizar:** se registra; se descuenta lo disponible sin quedar negativo y el faltante queda como anomalía auditada para conteo, en vez de trabar la cola.
- **Asientos de compra duplicados históricos:** script de solo lectura que lista duplicados y propone contra-asientos; se aplican solo con comando explícito tras revisión del contador.
- **403 vs 409 en precio no autorizado:** se mantiene 409 (`PRICE_OVERRIDE_NOT_ALLOWED`): el caso típico es catálogo desactualizado en pantalla.

### ADR-009 — Riesgos aceptados en la ola de endurecimiento
- **Fecha:** 2026-09-25
- `Bearer` sigue aceptado porque lo usan los smokes RBAC/integridad/comercial; la UI usa solo cookie.
- El logout no incrementa `token_version`: revocaría la sesión del usuario en todas sus terminales. La cookie es HttpOnly + SameSite=Strict.
