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

### ADR-027 — Valuación de la mercadería por costo de última compra (usuario, 2026-10-17)
- **Estado:** implementado en la rama `feat/revaluacion-stock` (I1-I8). Plan y criterios en `docs/execution/PLAN_VALUACION_INVENTARIO.md`; transición en `RUNBOOK_VALUACION_INVENTARIO.md`.
- **Origen:** la primera versión (revaluar al cambiar el costo) quedó frenada por AUD-015: el mayor no era stock × costo, porque las compras entraban al costo de la factura y las ventas salían a `purchase_price`. El usuario eligió la **opción a: costo de última compra** (costo de reposición, RT 17).
- **Invariantes:**
  - el mayor de Inventario (1.1.04.01) es igual a la suma de cantidad × costo del producto en las ubicaciones valuadas, al centavo; Mermas no se valúa;
  - el saldo de **2.1.01.02 "Mercadería recibida a facturar"** es igual a lo pendiente de los remitos no facturados;
  - todo movimiento de stock valuado deja su asiento en la misma transacción, con el costo leído bajo bloqueo, y queda vinculado a él (`inventory_movements.journal_entry_id`).
- **Decisiones del usuario:**
  - **D1:** el costo sale del remito (precio de la OC). Si la factura difiere, la diferencia va a tenencia y corrige el costo. Cada producto tiene dos casillas, marcadas por defecto:
    - actualizar el costo con cada compra; si se desmarca, el costo queda fijo y la diferencia va a resultados;
    - ajustar el precio de venta al costo manteniendo el margen.
  - **D2:** no hay factura de mercadería sin remito. La compra chica se registra con un remito sin OC.
  - **D3:** pasar a Mermas es una pérdida; traerla de vuelta la recupera.
  - **D4:** el ajuste de la transición va contra 3.1.03.01. Lo tiene que confirmar el contador.
  - **D5:** solo el administrador y el gerente cambian el costo (permiso `products.cost_edit`).
  - **D6:** cargar el costo a stock que tenía costo 0 es un ajuste de inventario inicial, no una ganancia.
  - **D7:** la devolución de mercadería sin facturar se hace contra su remito.
  - **D8:** el costo de lo vendido se registra cuando la mercadería sale.
  - **D9:** la factura manual sin pedido no registra costo.
- **Asientos:**
  - salidas: CMV contra Inventario; el faltante offline va contra 5.1.02.02;
  - reingresos (anulación de pedido armado, devolución de cliente): al costo de hoy, revirtiendo el CMV al costo de salida, con la diferencia a 4.2.02.01;
  - garantías y conteos: al costo vigente;
  - recepción: Inventario contra 2.1.01.02;
  - factura de compra: salda 2.1.01.02;
  - devolución a proveedor: al costo en libros.
- **Bloqueos:**
  1. cabecera;
  2. hijos;
  3. inventario de todos los productos en una sentencia ordenada;
  4. productos (FOR SHARE para leer, FOR UPDATE para cambiar el costo);
  5. asientos.
  Un interbloqueo responde 409 `busy`.
- **Cambios de API:** se quitan POST `/api/movements` e `/api/inventory-movements`, porque grababan costos libres. La recepción con OC toma el costo de la OC.
- **Migraciones:**
  - 064: cuenta 4.2.02.01;
  - 065: cuenta 2.1.01.02, vínculo del movimiento con el asiento, fecha de corte y casillas por producto;
  - 066: lo saldado por remito, lo devuelto por remito y el remito de la devolución.
  El CHECK de inventario pasa a la **067**.
- **También del 2026-10-17:** el cajero puede importar clientes. PR #9 (importador) y PR #10 (`-Red`) se mergearon con autorización del usuario.

### ADR-026 — Importador de productos, clientes y proveedores desde planillas (usuario, 2026-10-17)
- **Pedido del usuario:** agilizar la carga inicial y las actualizaciones masivas.
- **Formato:**
  - Excel (.xlsx) o CSV con `;` o `,`, leídos en el navegador;
  - plantillas descargables con instrucciones;
  - encabezados reconocidos con o sin acentos y con sinónimos;
  - la fila de ejemplo de la plantilla nunca se importa.
- **Flujo:**
  - una vista previa que no guarda nada muestra, por fila, si se crea, se actualiza, ya existe o tiene errores (y por qué);
  - la importación va en tandas de 50 filas, cada una en su transacción, revalidada en el servidor. Pensado para servidores con límite de tiempo (Vercel) y para que un corte solo afecte su tanda.
- **Mismas reglas que la carga a mano:**
  - permisos;
  - precio de venta con IVA guardado neto y costo sin IVA (redondeado a centavos, como lo guarda la columna);
  - stock inicial solo para productos nuevos, con costo, fuera de ubicaciones que no venden, con movimiento y un asiento por tanda (`product_import`);
  - el stock de un producto existente nunca cambia;
  - los valores de catálogo faltantes se crean (auditados);
  - familias de talles y colores;
  - CUIT con lock y comparado sin guiones;
  - Responsable Inscripto con CUIT.
- **Idempotencia:** volver a importar el mismo archivo no duplica nada.
  - Productos: se reconocen por SKU, sin importar mayúsculas ni acentos.
  - Clientes y proveedores: por CUIT o, sin CUIT, por nombre exacto. Dos filas con el mismo nombre y sin CUIT son un error.
- **Existentes:** se saltean, o se actualizan con las celdas no vacías si se marca "Actualizar los que ya existen". Una celda vacía nunca borra.
- De paso:
  - proveedores ahora guarda la categoría que el formulario mandaba y se perdía;
  - la búsqueda de proveedores no se rompe con datos vacíos;
  - el costo del alta manual se redondea a centavos antes del asiento.

### ADR-025 — Decisiones del usuario sobre AUD-008 y AUD-013 (2026-10-16)
- **Conflicto de numeración con ARCA (opción a):** el comprobante queda trabado en `arca_conflict`, con aviso en el panel y en el contador de Facturación (ya existía). Lo resuelve el administrador a mano, consultando ARCA. El sistema no ofrece anularlo ni reemitirlo. Procedimiento en `docs/execution/RUNBOOK_CONFLICTO_ARCA.md`.
- **Cambio de punto de venta con comprobantes en verificación (opción a):** se permite, como hasta ahora. La verificación sigue usando el punto de venta guardado en cada comprobante (`arca_pos` y `arca_voucher_type`, migración 059).
- **Fecha impresa (opción a):** la de emisión, como hasta ahora.
- **Índices de cobros y cheques por factura (aprobado):** migración 063, solo índices. El CHECK de inventario pasa a la **064**.
- **Cheques al reemitir:** se confirma lo implementado en AUD-013.
  - Cambian de cliente cualquiera sea su estado: en cartera, depositado, rechazado o endosado.
  - Un cheque que pagó varias facturas queda en el cliente anterior.

### ADR-024 — Nota de crédito interna al anular por error de ARCA (usuario, 2026-10-14: opción b)
- Al anular y volver a emitir una factura sin CAE queda una **nota de crédito interna**: número `NCI-AAAA-NNNN`, tipo `INT`, estado `internal`, `reference_type = 'arca_error_annulment'`, vinculada a la factura anulada, por el total y con el mismo cliente.
- **El texto dice por qué, sin culpar a ARCA cuando no intervino (AUD-011):**
  - con un error registrado de ARCA: "anula la factura X, que ARCA no autorizó (error de ARCA en la factura). Motivo registrado: …" (`arca_error_annulment`);
  - un ticket: "anula el ticket X (comprobante no fiscal, no se informa a ARCA)" (`ticket_annulment`);
  - nunca enviada: "anula la factura X, que no llegó a autorizarse en ARCA (se anuló antes de enviarla)" (`unauthorized_annulment`).
  - Todas terminan con "Reemplazada por Y. No se informa a ARCA ni tiene CAE." Los contra-asientos llevan el número de la nota.
- **Plazo de 5 días:** se cuenta desde la venta original, siguiendo la cadena de reemisiones (volver a emitir no lo reinicia).
- **Migración 062** (el CHECK de inventario pasa a 063).
- **Nunca CAE (tres capas):**
  - el servicio de autorización la rechaza (409 `internal_credit_note`) antes de consultar a ARCA;
  - el adaptador de ARCA también la rechaza;
  - un CHECK de la base (`chk_credit_notes_internal_never_fiscal`, migración 062) exige que el tipo INT y el estado internal vayan siempre juntos, en las dos direcciones y sin huecos por valores vacíos, y prohíbe CAE o número de ARCA en una nota interna.
- **No cuenta dos veces:** la factura anulada ya salió de la cuenta corriente, así que la nota interna no entra en el saldo ni en las listas de notas por cliente. Solo aparece en la pantalla de notas de crédito, sin botones de autorizar ni de impresión fiscal ("Comprobante interno, no fiscal").
- Una factura con CAE se sigue corrigiendo solo con nota de crédito fiscal.

### ADR-023 — Decisiones del usuario sobre AUD-010 (2026-10-14)
- **Quién reemite:** cualquiera con permiso de facturación (cajero incluido). Sin control de límite de crédito del cliente nuevo.
- **A/B a ticket: permitido.** A, B y ticket son intercambiables (los tres asientan IVA débito). La C sigue solo a C.
- **Antigüedad ("lo que se estile"):** 5 días corridos desde la emisión, el plazo que ARCA admite para fechar comprobantes de venta de bienes. Pasado ese plazo solo el administrador puede reemitir; queda auditado (`age_days`, `late_by_administrator`).
- **Alerta de 24 h:** solo cuenta comprobantes emitidos después de configurar ARCA. `company_settings.arca_configured_at` (en la migración 061, que todavía no salió de local y QA) se fija la primera vez que las credenciales quedan completas. Si ya estaban configuradas, la migración la fija en el momento de aplicarse.
- **Fecha y "reversión" (punto 4):** resuelto en ADR-024 (nota de crédito interna, no fiscal). La factura nueva lleva la fecha del día.

### ADR-022 — Decisiones del usuario sobre AUD-009 (2026-10-13)
- **Monotributista recibe B, nunca A** (legislación argentina, según el usuario; o C si el emisor es monotributista). Solo el Responsable Inscripto recibe A y es el único al que se le exige CUIT de 11 dígitos. Esto reemplaza lo dicho en ADR-021 sobre el Monotributista.
- **Anular y volver a emitir** (`POST /api/invoices/:id/reissue`, permiso de facturación): solo para una factura sin CAE en estado 'issued' (rechazada, sin CUIT o nunca enviada). Si tiene CAE, se corrige con nota de crédito; si está en trámite con ARCA, se espera. En una sola transacción:
  - se crea una factura nueva con las mismas líneas e importes, la letra y el cliente elegidos, numerada de nuevo y con `replaces_invoice_id` (migración 061);
  - la anterior queda 'cancelled', con baja lógica (sale de listados, libro IVA y cuenta corriente) y sin pedido (una factura por pedido); el pedido apunta a la nueva;
  - contabilidad: contra-asientos de la venta y del costo de la anterior y asientos de la nueva; los asientos de cobro se conservan;
  - los cobros (y cheques) pasan a la nueva y al cliente nuevo, junto con el saldo pendiente;
  - se audita `REISSUE_INVOICE`. Se rechaza si tiene notas de crédito o si no cambia nada (mismo cliente con datos actualizados sí se permite: refresca CUIT y condición).
  - Ajustes de AUD-010:
    - el IVA se conserva: A y B entre sí, ticket a A o B, C solo a C; una factura electrónica nunca pasa a ticket;
    - un saldo pendiente nunca queda sin deudor (no se reemite a Consumidor Final si se debe algo);
    - una devolución en curso del pedido lo bloquea, y el pedido sigue siempre al cliente de la factura;
    - el costo se copia del asiento revertido en vez de recalcularse;
    - la anulada guarda su rótulo (`annulled_label`), porque su número provisorio puede moverse si ARCA se lo da a otra;
    - no se reemite a un cliente dado de baja.
  - La toma de la autorización ARCA es condicional: un documento anulado nunca se envía a ARCA (también si se anula mientras otro intenta autorizarlo).
- **Alerta de 24 h:** facturas electrónicas (A, B, C) y NC de facturas electrónicas sin CAE y sin ningún intento después de 24 h. Solo cuando ARCA está configurado (si no, todas lo serían).
- **Clientes sin condición:** no se cargan uno por uno. Donde se factura (cobro del POS, facturación de pedidos, factura manual) aparece el aviso "sin condición frente al IVA" con "Cargar ahora" (`PUT /api/clients/:id/tax-condition`, con lock y auditoría), que aplica la letra al instante. En Clientes, un filtro "Sin condición IVA (N)".
- **Sin permiso especial** para cargar la condición.
- **Impresión:** sin condición cargada se imprime "Consumidor Final".
- **Migración 061.** (El CHECK de inventario es ahora la 063: ver ADR-024.)

### ADR-021 — Condición de IVA del cliente y alertas de ARCA (usuario, 2026-10-13: pasos 2 y 3)
- **Condición de IVA del cliente:** `clients.tax_condition_id` (migración 060, sin FK: los nombres salen de la lista compartida `CLIENT_TAX_CONDITIONS`), con las 4 condiciones existentes. Inscripto y Monotributista exigen CUIT de 11 dígitos. Vacía significa "sin especificar". Se carga en el alta y la edición de clientes, y en el alta rápida del POS y de pedidos.
  - **Factura:** copia el nombre de la condición, y ARCA recibe ese código (RG 5616). Sin condición cargada, sigue el comportamiento anterior: Consumidor Final, o Responsable Inscripto en una Factura A.
  - **Control de la letra (RG 5616):** toda Factura A exige un cliente con CUIT (422 `invoice_cuit_required`). Con la condición cargada, una Factura A solo va a un Responsable Inscripto o Monotributista, y una B al resto (422 `invoice_type_mismatch`). Todo se controla antes de numerar. La C y el ticket no se controlan.
  - **Venta offline reproducida:** no se rechaza, porque la venta ya ocurrió. Como el número todavía es provisorio, la letra se corrige a la que ARCA acepta y el cambio queda auditado (AUD-009).
  - **Sugerencia en pantalla:** el POS y la facturación de pedidos sugieren la letra según la condición del cliente; el cajero puede cambiarla. No se sugiere nada si la empresa es monotributista.
- **Alertas de ARCA:** `GET /api/fiscal/arca-alerts` (permiso de facturación) lista facturas y NC en conflicto, las que llevan más de 10 minutos en verificación y las rechazadas (pendientes sin CAE y con motivo). Los 10 minutos equivalen a varias pasadas fallidas del worker, que corre cada 2 minutos.
  - **Panel:** muestra una tarjeta con enlace a cada comprobante, solo si hay alertas.
  - **Menú:** "Facturación" muestra un contador, que se actualiza cada 2 minutos y tras cada intento de autorizar.
- **Migración 060.** (La regla del Monotributista y el CHECK, ahora 062, se actualizan en ADR-022.)

### ADR-020 — Autorización ARCA sólida (usuario, 2026-10-13: "dejar sólido lo vinculado a ARCA")
- **Problemas encontrados:**
  - La recuperación de una respuesta perdida comparaba solo el último comprobante de ARCA por total y documento. Dos tickets iguales seguidos a consumidor final podían compartir CAE, y si en el medio se autorizaba otro, la factura quedaba sin recuperar y se emitía dos veces.
  - Un error de red al consultar se tomaba como "no existe" y se pedía otro CAE.
  - La llamada a ARCA corría dentro de una transacción con la factura bloqueada.
  - El número de ARCA podía chocar con el número provisorio de otra factura pendiente, después de emitido el CAE.
  - La NC no guardaba su número de ARCA.
  - Una NC caída en 'authorizing' quedaba trabada.
  - La caché de ARCA no tomaba un certificado renovado.
- **Diseño:** `domains/fiscal/ArcaAuthorizationService.js` es un flujo común con adaptadores de factura y de NC.
  1. Se reclama el documento ('authorizing') en una transacción corta.
  2. Un lock con nombre por punto de venta y tipo serializa la numeración entre procesos. El documento se relee bajo el lock.
  3. Un intento previo se resuelve preguntando a ARCA por exactamente ese número. Se adopta solo si coinciden tipo, total, documento del cliente, fecha y comprobante asociado, y ningún otro documento local lo tiene.
  4. El número y la fecha (hora de Argentina) se guardan antes de pedir el CAE.
     - Si ARCA rechaza, el número no se usó y el documento vuelve a pendiente con el motivo.
     - Si ARCA no responde, se le pregunta por ese número. Si sigue sin saberse, el documento queda en verificación y un worker lo resuelve cada 2 minutos, sin pedir nunca otro CAE a ciegas.
  5. El resultado se guarda en una transacción corta.
     - Si otra factura pendiente tenía ese número provisorio, pasa a uno nuevo, con auditoría.
     - Los provisorios siguientes continúan después del número de ARCA.
     - La NC guarda `arca_voucher_number`.
- **Validaciones:**
  - La Factura A y la NC A exigen el CUIT del cliente: se rechazan antes de llamar a ARCA.
  - El certificado renovado se usa sin reiniciar el servidor.
- **Migración 058.** El CHECK de inventario pasa a 059.

### ADR-019 — Varios remitos por factura de compra y stock único con Tiendanube (usuario, 2026-10-13)
- **Remitos:**
  - Una factura de compra puede cubrir uno o varios remitos (recepciones) del mismo proveedor, en la tabla `supplier_invoice_receptions` (migración 056).
  - Un remito se factura una sola vez: es único y se bloquea al cargar la factura. Solo se facturan remitos con el control de calidad aprobado (usuario, 2026-10-13).
  - La pantalla suma lo recibido (cantidad × costo) y avisa, sin bloquear, si la factura difiere.
- **Stock único con Tiendanube:**
  1. Se publica el disponible: físico en ubicaciones vendibles menos lo reservado por pedidos locales u online. No se publica el físico total.
  2. Lo más conveniente en recursos y costos (decisión delegada por el usuario):
     - Envío inmediato tras ventas, pedidos y movimientos.
     - Conciliación en segundo plano cada 20 s, solo de productos cuyo stock o reservas cambiaron (consulta liviana).
     - Comparación completa cada hora.
     - A Tiendanube solo se lo llama cuando cambió el valor publicado (`tiendanube_stock_state`).
     - Un reintento publica el disponible actual, no el valor del momento del fallo.
  3. Un pedido de Tiendanube se registra siempre. Si falta stock, reserva lo que hay y queda como excepción "Pedido online sin stock" para el gerente, en Excepciones POS.
  4. Stock de seguridad opcional, decidido por la política con un check en la configuración de Tiendanube. Por defecto está apagado. Tiene unidades generales y un valor opcional por producto.

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
- **NC manual idempotente:** el formulario envía una clave única por intento; un reintento con la misma clave devuelve la NC ya emitida. Requiere la migración 045 (`credit_notes.idempotency_key` único); la migración del CHECK de inventario pasa a ser la 063 (046-062 agregan cuentas, NC fiscal, tesorería e idempotencia, precios a 4 decimales, débitos bancarios, alícuotas y ajustes de pedido, corrigen totales previos agregan la condición de IVA del cliente y la reemisión de facturas y la nota de crédito interna; ADR-013/014/015/016/021/022/024).
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
