# Evidencia de revisión — WSM SportsERP

## AUD-008 — 2026-10-13 — `guardian-integridad` sobre ADR-020 (autorización ARCA)

El guardián encontró 3 caminos altos a doble CAE en la primera versión y varios medios. Se rediseñó el flujo:
- [x] **Alta:**
  - Al vencer el lock se borraba el número pedido de un documento que podía estar en curso. Ahora "ocupado" responde 409 sin tocar el documento, y el estado ARCA solo lo modifica quien tiene el lock.
  - Ante una falta de respuesta se liberaba en el acto. Ahora el documento nunca se libera sin que ARCA confirme que el número no existe y sin pasar 2 minutos de enfriamiento.
  - Los rechazos se clasificaban sin verificar. Ahora también se verifica antes de liberar: si el comprobante se emitió igual, se adopta.
- [x] **Media:**
  - Todo el trabajo de base bajo el lock usa la misma conexión, así el pool no puede trabarse.
  - El documento pasa a 'authorizing' solo cuando su número queda guardado.
  - El worker no se superpone consigo mismo, no espera el lock y nunca crea comprobantes.
  - `_finish` no repite la autorización ni la auditoría.
  - Un conflicto de numeración después de emitido el CAE deja el documento en estado terminal 'arca_conflict', con el CAE guardado, y nunca pide otro.
  - Se guardan el punto de venta y el tipo pedidos (migración 059) y se verifica contra ellos.
  - Si no se puede consultar a ARCA antes de pedir, nada cambia (503 `arca_unreachable`).
- [x] **Baja:**
  - Una respuesta sin CAE se trata como incierta y se verifica.
  - La pantalla distingue "en verificación" (informativo) de "no se pudo consultar" (error) y del conflicto.
- **Verificado en el SDK 1.2.3:** `getVoucherInfo` devuelve null ante el código 602 (no existe) y lanza los demás errores; los rechazos son `AfipWebServiceError` con el código de ARCA.
- **Solo verificable en homologación de ARCA:** la NC con `CbtesAsoc`; Factura C y NC C sin `Iva`; `CondicionIVAReceptorId` (RG 5616), que ahora se envía desde la condición guardada en la factura (A va a Responsable Inscripto salvo que diga Monotributo); un pedido que llega tarde después de un timeout.
- **Decisiones de negocio pendientes:**
  - procedimiento manual ante 'arca_conflict';
  - si se permite cambiar el punto de venta con comprobantes en verificación (el sistema verifica igual en el punto de venta original);
  - si la fecha impresa debe ser la de autorización.

Evidencia: validate 0 (946 + 91); coverage 96,63/90,85/94,13; integración 104/104 ×3 (14 escenarios ARCA con base real); RBAC OK; E2E 6/6.

## AUD-007 — 2026-10-13 — `guardian-integridad` sobre ADR-018/019 (delta sin commitear)

El coordinador verificó y corrigió cada hallazgo técnico:
- [x] **Alta:**
  - Un pedido online sin asignaciones caía en la rama "legacy" y, al cancelarse, liberaba reservas de otros pedidos. Ahora los pedidos que se reservan por asignaciones se marcan (`orders.allocation_tracked`, migración 057) y nunca usan esa rama. Hay test MySQL.
  - Las unidades pickeadas por encima de lo reservado no se descontaban al empacar. Ahora salen del disponible, sin quedar negativo. Hay test MySQL.
  - Republicar el producto mandaba otro número y no actualizaba el estado. Ahora usa el mismo disponible y lo registra, y una variante re-vinculada se vuelve a publicar.
- [x] **Media:**
  - Backoff por producto (de 30 s a 1 h) y `failed_syncs` ya no reinicia los intentos.
  - La corrida se corta tras 5 fallos seguidos.
  - Se publica un producto a la vez, leyendo el valor justo antes de enviar.
  - Una corrida completa pedida durante otra no se pierde.
  - La ventana incremental usa el reloj de la base, con índice en `inventory.updated_at`.
  - Un aumento (o una primera publicación) espera mientras hay pedidos online sin importar de los últimos 30 minutos.
  - Lo que deben los pedidos online se descuenta de lo publicado y se reserva solo cuando entra stock, empezando por el pedido más viejo. Hay test MySQL.
  - Un producto borrado se publica con 0.
  - Dos facturas simultáneas sobre un remito: la segunda recibe 409, no 500.
- [x] **Baja:**
  - La lista de ubicaciones no vendibles se toma de `StockLedger`.
  - Publicación forzada diaria, que corrige ediciones hechas a mano en el panel de Tiendanube.
- **Pendiente / decisión:**
  - [x] Facturar remitos con control de calidad pendiente: bloqueado por decisión del usuario (409 `reception_not_approved`).
  - Varias instancias del servidor duplicarían las corridas: hoy hay una sola.

Evidencia: validate 0 (890 + 87); coverage 96,81/90,29/94,24; integración 88/88 ×3; RBAC OK; E2E 6/6; simulación 153/153.

## AUD-006 — 2026-10-12 — `guardian-integridad` sobre ADR-017 (delta sin commitear de `codex/simulacion-operativa`)

Todos los hallazgos técnicos fueron verificados y corregidos:
- [x] Alta: dos aprobaciones simultáneas devolvían el envío dos veces. La lectura de REPEATABLE READ fijaba la foto antes del lock del pedido. Ahora el pedido se bloquea antes de cualquier lectura sin lock. Hay test MySQL con `Promise.all`.
- [x] Alta: el script de precios podía bajar un 17 % el precio de un producto creado en el ERP y vinculado después por SKU. Ahora se clasifica como del ERP si tiene alta auditada o si existía antes de vincularse.
- [x] Media:
  - No se puede cambiar el envío si el pedido tiene cobros en cuenta corriente o devoluciones.
  - La alícuota queda guardada en cada línea del pedido (migración 054): cambiar la del producto ya no cambia lo que factura un pedido abierto.
  - La importación de Tiendanube es atómica por producto.
  - El descuento sobre el envío no se prorratea en una entrega parcial (el envío se cobra completo), igual en el servidor y en la pantalla.
- [x] Baja:
  - El IVA de cada alícuota de compra se valida contra su neto.
  - Los totales del comprobante tienen que ser la suma de sus alícuotas, y el neto debe ser mayor a 0.
  - La línea "Envío y otros cargos" de facturas viejas no se bonifica como envío.
  - Se agregó un índice en `client_returns.order_id`.
  - El retiro en mostrador usa el precio de catálogo con 4 decimales.
- Pendiente o decisión: el producto se crea fuera de la transacción de su stock inicial (patrón previo); una NC de devolución anulada sigue contando el envío como devuelto.

Evidencia: validate 0 (878 + 84); coverage 96,88/90,17/94,75; integración 81/81 ×3; RBAC OK; E2E 6/6; simulación 153/153.

## AUD-005 — 2026-10-12 — `guardian-integridad` sobre ADR-016 (delta sin commitear de `codex/simulacion-operativa`)

El coordinador verificó y corrigió cada hallazgo técnico:
- [x] **Alta:** con un cupón repartido en varios productos, las devoluciones podían sumar 1 centavo más que la factura, y la última daba 409.
  - Ahora el descuento de cada alícuota se reparte por mayor resto (`allocateCents`), así que los productos suman exactamente lo cobrado.
  - La última unidad devuelve lo que queda de lo cobrado menos lo ya devuelto.
  - Hay test unitario y uno MySQL (3 productos con cupón, devueltos de a uno, suman la factura).
- [x] **Media:**
  - La NC a ARCA toma la alícuota de la línea de factura, no la del producto hoy.
  - Picking parcial: el descuento conserva su porcentaje sobre lo preparado, con auditoría, y la pantalla calcula igual que el servidor.
  - Una línea sin preparar ya no se factura completa.
  - Una devolución no supera lo facturado (409 `return_exceeds_invoiced`).
  - La devolución a proveedor revierte el crédito fiscal en la cuenta que usó el asiento de esa compra.
  - El total de una compra se compara con sus partes en centavos exactos.
  - Una compra con IVA y alícuota 0 % se rechaza.
  - El asiento exige Debe = Haber al centavo; antes toleraba 1 centavo.
  - La migración 052 guarda los totales anteriores en `orders_total_backup_052`, con la reversión documentada, y cubre pedidos con factura borrada.
  - Los pedidos de Tiendanube anteriores a la 051 facturan la diferencia con lo cobrado.
- [x] **Baja:**
  - Un débito muy chico queda entero en el gasto (antes daba error).
  - El reintento de una acreditación se resuelve antes de validar las alícuotas.
  - Un descuento mayor que los productos pasa a ser descuento sobre el envío.
  - Un nombre de alícuota duplicado responde 409.
  - El script de precios excluye las altas del ERP con stock y avisa que hay que republicar.
  - El IVA del descuento se calcula con una sola fórmula (`grossLineAmounts`).
- **Descartado:** "producto repetido en el script por variantes": `tiendanube_catalog_variants.product_id` es único.
- **Observación:** en 1 de 5 corridas, el archivo `purchase-order-lifecycle.integration.js` falló completo al inicio (unos 200 ms), sin ninguna aserción fallida. Las otras 4 corridas dieron 74/74. No toca código de ADR-016; queda a investigar.
- **Decisiones de negocio pendientes:**
  - el IVA del envío y del recargo (hoy 21 %);
  - si el envío se devuelve al devolver todo;
  - envío y descuento en un picking parcial;
  - facturas de compra con varias alícuotas.

Evidencia: validate 0 (873 + 83); coverage 98,03/90,48/95,97; integración 74/74 en 4 de 5 corridas (ver la observación); RBAC OK; E2E 6/6; simulación 153/153.

## AUD-004 — 2026-10-12 — `guardian-integridad` y `revisor-ux` sobre ADR-015 (delta sin commitear de `codex/simulacion-operativa`)

El coordinador verificó cada hallazgo en el código antes de corregirlo:
- [x] Alta: la NC de una devolución mandaba a ARCA ítems sin `total_line`/`vat_amount`. Ahora salen de `lineAmounts`.
- [x] Alta: el saldo de Caja 2 se leía de una foto vieja de la transacción (REPEATABLE READ), lo que permitía dos gastos concurrentes por encima del saldo. Ahora se toma el lock de la cuenta y la suma se hace `FOR SHARE`. Hay test MySQL concurrente.
- [x] Media: el saldo del cajón al sacar efectivo tenía el mismo problema; ahora se calcula con lock.
- [x] Media: el precio vendido promedio de una devolución se redondeaba a 2 decimales; ahora a 4.
- [x] Media: una venta offline encolada antes del cambio quedaba trabada por centavos. Ahora el último pago absorbe hasta 1 centavo por línea, con auditoría, y la caja y la factura usan el mismo monto.
- [x] Baja: el precio pedido igual al del catálogo redondeado pierde los 4 decimales. Ahora se usa el del catálogo.
- [x] Baja: orden de locks (Caja 2 antes que el turno), replay `FOR SHARE`, validación de la clave y clave obligatoria en traspasos.
- [x] Baja: rótulos de `transfer_in`/`transfer_out` en el reporte Z. No hace falta cambio: el reporte solo muestra entradas y salidas totales, que ya los incluyen.
- [x] UX (13 puntos):
  - montos con `formatMoney`, "Total a pagar" con neto + IVA, y botones del carrito de 44 px con nombre;
  - estados de carga y error, y confirmación, en Caja 2 y Tarjetas;
  - saldo de Caja 2 en el pago a proveedor;
  - las etiquetas de código de barras nunca imprimen el costo;
  - Ley 27.743: "IVA contenido" en la factura B y el ticket, la A discriminada y la C sin IVA;
  - factura manual validada.

## AUD-003 — 2026-10-12 — `guardian-integridad` sobre ADR-012 (delta sin commitear de `codex/sql-out-of-controllers`)

El guardián (opus) informó 5 hallazgos. El coordinador verificó cada uno en el código antes de corregir:

- [x] Media-alta: aprobar una recepción pisaba el estado de la OC sin bloquearla. Una OC anulada se reabría a `partial`/`received` y entraba stock; una `received` retrocedía. Corregido así:
  - la aprobación bloquea la OC antes que sus ítems (además saca el posible deadlock con `createReception`);
  - responde 409 si la OC está anulada y nunca hace retroceder una `received`;
  - una OC con mercadería recibida o en control de calidad no se puede anular.

  Hay 4 tests MySQL, incluida una carrera real entre anular y aprobar.
- [x] Media: una clave de NC reusada con otro cuerpo devolvía la NC anterior como éxito. Ahora responde 409 `idempotency_key_reused` con el número ya emitido, y el formulario rota la clave y avisa cuando la respuesta es un replay. 1 test MySQL y 4 unitarios.
- [x] Baja: un `dist` desactualizado de `@wsm/common` descartaría la clave en silencio. Lo cubren el Dockerfile (compila common) y un test de contrato del schema dentro de `validate`.
- [x] Baja: un solo reintento ante colisión. Ahora son hasta 3 intentos con clave, y sin clave no se reintenta. Hay test.
- [x] Informativo: la transición al mismo estado escribía y auditaba ruido. Ahora no escribe nada.

Evidencia: validate 0 (810 + 69), coverage 99,27 / 91,81 / 99,01, `qa:integration` 52/52 en tres corridas, RBAC OK.

## AUD-002 — 2026-09-26 — re-auditoría de integridad `d925dfa..f8a47df`

`guardian-integridad` (opus): los cierres de AUD-001 se verificaron con sus gemelos; 5 hallazgos nuevos
sobre el código agregado, verificados por el coordinador y corregidos:

- [x] F1 alta — replay offline tras cerrar el turno duplicaba el cobro en caja (búsqueda por turno) — ahora por pedido en cualquier turno; test MySQL del escenario completo.
- [x] F2 media — venta offline con faltante total aparecía como pendiente de reparación C1 — excluida del diagnóstico; test MySQL.
- [x] F3 media — retiro de pedido sin red se encolaba como venta nueva (duplicado) — bloqueado con aviso al cajero.
- [x] F4 baja — criterio offline distinto para reasignar turno — unificado en `isOfflineReplay`.
- [x] F5 baja — unidades rechazadas consumían cupo de devolución — excluidas.
- [x] Decisión abierta: `offline_captured_at` declarado por el cliente — **aceptado** por el usuario (ADR-011): revisión obligatoria en Excepciones POS + contador de pendientes en el menú (2026-10-12).
- [x] Devolución a proveedor — corregido (ADR-011, `05e149a`): espeja la compra con IVA CF según la última factura asentada, sin recorte de saldo, transacción `adjustment`.

Evidencia: unit 476/476, `qa:integration` 42/42, `validate` exit 0.

## AUD-001 y revisión de integridad — 2026-09-25 — `4221d26..d925dfa` (Ola A + Ola B parcial)

Dos revisiones independientes en paralelo, sin contexto de la sesión: `auditor-externo`
(opus) — veredicto **con reservas**, 5 de 10 criterios del plan verificados — y
`guardian-integridad` (opus), 12 hallazgos. Cada hallazgo fue verificado en código por el
coordinador antes de actuar. Resolución (commits posteriores a `d925dfa`):

- [x] Estado de pedido escrito directo en `tiendanube.updateFulfillment` (gemelo de C1) — corregido: pasa por `applyExternalStatus` (acepta `dispatched`).
- [x] Cobranza multi-documento completaba pedidos no entregados (gemelo) — corregido: solo `delivered → completed`.
- [x] `createManualInvoice` con `order_id` tomaba ítems/precios/IVA del cliente — corregido: delega en `createInvoice(orderId)`.
- [x] IVA del pedido tomado del cliente; total POS por heurística — corregido: IVA del catálogo, total POS = neto + IVA.
- [x] Turno cerrado en ventas offline / reintento no idempotente — corregido por el checkout atómico `POST /api/pos/checkout` (`ba8391e`).
- [x] NC: monto sin IVA con precio del cliente; ARCA recibía ítems rechazados — corregido: precio vendido, bruto, asiento con IVA DF, ítems rechazados excluidos.
- [x] Extras del retiro en mostrador con `GREATEST` y bloqueo en orden de payload — corregido: `StockLedger`, orden estable, total bruto.
- [x] `applyRemoteStatus` tragaba errores; regla "entregado sin picking" sin test — corregido: propaga (cola durable de webhooks reintenta); 2 tests MySQL.
- [x] Script de reparación: clase B por pedido, B quedaba `pending`, carrera diagnóstico/reparación, "pagado" incompleto, liberaba reservas de asignaciones ajenas — corregidos los cinco, con 5 tests MySQL nuevos.
- [x] TASKS/plan desactualizados; ediciones en `C:\Dev\Base claude` sin registro — actualizados (ADR-007 las registra: pedidas por el usuario).
- [x] **Decisión del usuario:** excepción de precio offline — aceptada con revisión obligatoria (ADR-010/011).
- [x] 409 `PRICE_OVERRIDE_NOT_ALLOWED` en vez del 403 del plan — aceptado (ADR-010): el caso típico es catálogo desactualizado en pantalla (conflicto de estado), el mensaje guía al cajero.
- [ ] NC en `authorizing` si el proceso cae tras aprobar ARCA — queda para la fase H2 (recuperación consultando el último comprobante).
- [x] Cobertura ≥ 90 % — gate global en verde desde `1ff2122` (Ola C); 2026-10-12: 99,13 / 91,78 / 98,88 %, y corre en CI (`test:coverage:isolated`).

## Actualización: correcciones autorizadas y QA local

2026-09-06. Implementación por dos Luna max; lectura, planificación, revisión y
verificación por el coordinador. Se dio feedback y se revisaron las correcciones.
No hubo un subagente revisor. El diagnóstico inicial conservado debajo es histórico.

| Comprobación final | Resultado |
|---|---|
| npm run validate | exit0: 7 guards,431 backend,62 cliente; lint sin warnings, tipos/build correctos |
| npm run test:coverage | exit1: 81,23/88,82/73,98 %, con431 tests aprobados; gate90 conservado |
| Bootstrap MySQL8.0.46 limpio/repetido | exit0,42 migraciones y4 usuarios; reanudación también comprobada |
| qa:preflight:integrity | exit0,40 relaciones, sin huérfanos/duplicados reportados |
| qa:smoke:rbac | exit0,12/12 HTTP sobre aplicación efímera y MySQL QA |
| qa:smoke:integrity | exit0,4/4 básicos;3 circuitos opcionales omitidos |
| Playwright Chromium | exit0,2/2 login con API simulada |
| Numeración y catálogo MySQL | Valores consecutivos y agrupación/hash coherentes; datos ficticios con rollback |

H-01 corregido con17 tests dirigidos; H-06 mitigado por wrappers/QA. H-03 implementado
en workflow, todavía sin ejecución remota. H-02 sigue abierto: no todos los gates
están verdes. Se corrigieron también compatibilidades de migraciones y pruebas
dependientes del entorno. Los42 SQL históricos conservaron sus hashes.

El build normal final tiene chunk inicial492,33kB (149,94kB gzip). La medición
anterior721,76kB provenía de validate con NODE_ENV=development global: no se presenta
esta diferencia como una optimización de rendimiento de la aplicación.

La revisión automática exigió permiso explícito para migrar. El usuario lo concedió
solo para wsm_qa en127.0.0.1:33308. No se ejecutaron mutaciones en base remota.

Logs: logs/qa-hardening-2026-09-06/. [Informe completo](../../docs/execution/MEJORAS_QA_2026-09-06.md).

## Diagnóstico inicial (antes de las correcciones)

Fecha: 2026-09-06. Adaptado de Base Codex `template/.ai/AUDIT.md`.

## Alcance

Análisis estructural y revisión selectiva de código; adaptación documental y
perfiles de revisión. Se preservaron los cambios funcionales previos.
Coordinador: Codex, aplicando criterios de arquitectura, QA, seguridad y mantenimiento.
Auditoría independiente: `not_run`. No se ejecutaron subagentes.

## Verificaciones

Entorno: Windows/PowerShell, Node v24.15.0, npm 11.12.1 instalados.
El CI declara Node 20; esta revisión no reproduce ese runtime.

| Verificación | Resultado | Evidencia / límite |
|---|---|---|
| npm run typecheck | pass, exit 0 | common + cliente |
| npm run validate | pass, exit 0 | Aislado de MySQL remoto; 392 backend + 61 cliente (16 archivos) |
| ESLint dentro de validate | pass con warning | POS.tsx:246, dependencia loadData en useEffect |
| Build Vite dentro de validate | pass con warning | Chunk inicial 721,76 kB, 210,56 kB gzip; umbral de aviso 500 kB |
| npm run preflight:integrity | pass, exit 0 | Solo SELECT: 40 relaciones sin huérfanos; sin duplicados reportados |
| npm run test:coverage | fail, exit 1 | 79,38 % líneas / 89,82 % ramas / 72,34 % funciones; umbral 90 % |
| npm run smoke:rbac | blocked, exit 1 | En entorno aislado, /api/health devuelve 503; no llega a los 12 casos |
| npm -w @wsm/client run test:e2e -- --reporter=line | blocked, exit 1 | Dos pruebas sin iniciar navegador: falta Chromium headless shell |
| Test-CodexTemplate.ps1 sobre el original | pass, exit 0 | 13 rutas esenciales y 5 perfiles; solo estructura de plantilla |
| Reproducción H-01 con dependencias simuladas | fail del criterio funcional | Pedido delivery aceptado por el caso de uso pickup; commit simulado |

Logs locales: `logs/base-codex-2026-09-06/` (ignorados por Git).
Resumen reproducible y alcance de aislamiento en [QUALITY](QUALITY.md).
El reporte de cobertura incluye archivos instrumentados por el runner; no se
presenta como cobertura exclusiva de código productivo ni de todo el repositorio.

## Hallazgos

| ID | Severidad | Archivo/símbolo | Evidencia e impacto | Recomendación | Estado |
|---|---|---|---|---|---|
| H-01 | high | domains/sales/PickupOrderCheckoutUseCase.js:execute | Solo valida estado; acepta shipping_method=delivery y registra entrega | Guard sobre el pedido bloqueado, antes de mutaciones; test negativo delivery + positivo pickup | Corregido (2026-09-06; guard `shipping_method !== 'pickup'`) |
| H-02 | high | server/package.json:test:coverage | Los tres porcentajes están por debajo de 90 %; validate no ejecuta este gate | Cubrir escenarios de negocio faltantes y añadir cobertura a CI tras resolver el fallo | Corregido (`1ff2122`; gate en CI) |
| H-03 | medium | .github/workflows/ci.yml | No hay jobs de cobertura, E2E, RBAC o MySQL | Añadir pruebas con datos efímeros y evidencia publicable | Corregido (cobertura, E2E, RBAC e integración MySQL en CI; verde en PR #1) |
| H-04 | medium | .agents/context/PROJECT.md y QUALITY.md anteriores | Backend descrito como TS y lint backend inexistente; ruta de migraciones incorrecta | Alinear documentación con scripts y rutas reales | Corregido documentalmente |
| H-05 | medium | .ai/TASKS.md y docs/execution/STATE.md anteriores | Copia desactualizada, 89 KB de estado y afirmación 100/100 sin gate completo | Fuente canónica, enlaces y archivo histórico | Mitigado documentalmente |
| H-06 | medium | Entorno de tests/smokes | Desarrollo usa DB remota; smoke necesita fixtures reales | Diseñar MySQL de pruebas y guard de aislamiento antes de integrar smokes | Mitigado (`wsm_qa` + comandos `qa:*`; el servidor rechaza host remoto en desarrollo sin `ALLOW_REMOTE_DB`) |

H-01 es una reproducción del caso de uso con mocks, no una explotación de la API
ni una operación sobre datos reales. La ruta requiere canSell: el fallo se
refiere a elegibilidad del pedido, no demuestra omisión de autenticación.

## Contrapruebas

- Contrastar “TypeScript completo” con los scripts: no hay check estático del servidor.
- Contrastar “100/100” con cobertura: gate rojo aunque validate esté verde.
- Entregar al caso de uso un pedido packed + delivery: acepta y hace commit simulado.
- Revisar conteo ciego: el controlador elimina cantidades esperadas/desvíos;
  no atribuir un fallo a getSession sin revisar esa capa de salida.

## Límites y decisión

Análisis entregable con hallazgos; cierre integral de calidad de la app pendiente.
No se certificó producción, seguridad exhaustiva, rendimiento de usuarios,
impresión/hardware, integraciones reales ni aislamiento de MySQL concurrente.
No se instalaron navegadores ni dependencias; no se ejecutaron migraciones.

La revisión automática rechazó el primer validate contra el entorno remoto.
Se resolvió esa limitación ejecutándolo con variables y credenciales ficticias
de aislamiento. El preflight SELECT se revisó y autorizó por separado.
RBAC remoto/mutante no se ejecutó; se deja para una base de pruebas controlada.

Ver [informe completo](../../docs/execution/ANALISIS_APP_Y_BASE_CODEX_2026-09-06.md)
y [riesgos](RISKS.md).


## Verificación de la adaptación documental

- 25 documentos Markdown comprobados: 0 enlaces locales rotos.
- 6 archivos TOML parseados: cinco roles de solo lectura, sin modelo/esfuerzo fijos.
- Hashes de 51 archivos preexistentes fuera de los dos snapshots: preservados.
- TASKS reducido de 18,3 KB a aproximadamente 2,2 KB; STATE de 89,1 KB a 1,4 KB.
- Se conservaron copias del historial antes de resumir. No se midió ahorro real de tokens.
