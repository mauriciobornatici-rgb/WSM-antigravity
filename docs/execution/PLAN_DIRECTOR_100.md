# Plan Director a 100/100 — WSM SportsERP

**Autor:** Dirección técnica (auditoría externa)
**Fecha:** 15 de junio de 2026
**Estado base auditado:** **73/100** (lente de *production-readiness*)
**Objetivo:** 100/100 verificable y sostenible.

> Dos números conviven y ambos son ciertos: el equipo estima **86/100** de *madurez de funcionalidad*; esta dirección parte de **73/100** de *production-readiness* (pondera fiscal real, seguridad, gates verificados y operación). Este plan cierra esa brecha de 27 puntos con criterios objetivos.

---

## 1. Decisión de dirección (por qué este camino)

1. **Primero el activo, después las features.** Hay ~3 semanas de trabajo valioso sin versionar sobre un filesystem que dio señales de inestabilidad. Ningún avance cuenta hasta estar commiteado y respaldado. **M0 es bloqueante de todo.**
2. **Nada entra a facturación sin gate verde.** Es un sistema fiscal/financiero. La regla es: ningún cambio se da por hecho si no pasó `npm run validate` + la QA manual definida. "El código existe" ≠ "está hecho".
3. **Secuencia por riesgo y valor, no por entusiasmo.** El orden es: recuperar → blindar fiscal (AFIP) → Tienda Nube productivo → operación/WMS → finanzas operativas → calidad/observabilidad. Cada milestone es independientemente entregable y sube puntaje medible.

---

## 2. Rúbrica medible de 100/100

| # | Eje | Peso | Base | Cómo se mide el 100% |
|---|---|---:|---:|---|
| E1 | Núcleo comercial (POS/Ventas/Facturación) | 15 | 13 | Venta y factura sin pérdidas; bandeja de factura POS fallida con reintento. |
| E2 | Fiscal AFIP (producción real) | 15 | 10 | CAE real validado en homologación, QR RG 4892, padrón, NC/ND completas, secretos cifrados. |
| E3 | Tienda Nube / Omnicanal | 12 | 8 | OAuth+webhook validados en HTTPS real, bidireccional (stock+fulfillment), import sin pérdida de ítems. |
| E4 | Inventario/WMS y trazabilidad | 12 | 10 | Trazabilidad por producto desde la ficha + ubicaciones/cuarentena + eventos de envío. |
| E5 | Compras/Proveedores/Recepción/Calidad | 10 | 7 | OT/aprobación real separada de envío; QC bloqueante antes de stock disponible. |
| E6 | Cuentas corrientes/Cobranzas/Caja/Contabilidad | 12 | 10 | Conciliación por medio de pago; cierre de caja validado; bandejas de pendientes. |
| E7 | Calidad técnica (tests/build/CI/refactor) | 12 | 9 | `validate` verde reproducible + e2e crítico + cobertura backend + archivos núcleo descompuestos. |
| E8 | Seguridad, observabilidad y DevOps | 12 | 6 | 0 vulnerabilidades altas/críticas, secretos cifrados, backups, monitoreo, repo sano. |
| | **Total** | **100** | **73** | |

---

## 3. Milestones (camino crítico)

Cada milestone declara: **alcance → Definition of Done (DoD) → gate de aceptación → Δpuntaje → esfuerzo**.

### M0 — Recuperación y baseline verde · **bloqueante** · Δ+4 · ~0,5–1 día
**Alcance:** asegurar el trabajo sin versionar y restablecer una corrida verde reproducible.
- Backup branch + commit de todo el árbol; push a remoto.
- Mover el repo fuera de carpeta sincronizada (OneDrive/Dropbox) a ruta local dedicada.
- `npm install` limpio (resolver `node_modules` de plataforma) y `npm run validate`.
- `npm audit fix` (no disruptivo) como primer recorte de vulnerabilidades.

**DoD:** existe commit + push con todo el trabajo; `npm run validate` pasa localmente; repo fuera de FS sincronizado.
**Gate:** salida verde de `npm run validate` + `git log` mostrando el checkpoint en remoto.
**Ejes:** E7 9→11, E8 6→8.
> Automatizado en `scripts/recover-and-validate.ps1`.

### M1 — Fiscal AFIP a producción · Δ+7 · ~1–2 semanas
**Alcance:** llevar la facturación de "funciona en lógica" a "emite legalmente".
- Validar emisión real de A/B/C en **homologación** con CUIT de prueba (set de casos: CF, RI, Monotributo; IVA 21/10,5/0).
- **QR fiscal (RG 4892)** y leyendas obligatorias en el comprobante impreso/PDF.
- **Consulta de padrón** (constancia) para autocompletar condición IVA y elegir A/B automáticamente.
- **Notas de crédito/débito** con CAE completas y trazadas a la factura/origen.
- **Cifrar secretos en reposo** (cert + key AFIP) y **eliminar la escritura de la key en `tmp` en texto plano**.

**DoD:** comprobantes con CAE real validados en homologación; QR escaneable verificable en AFIP; NC/ND emitidas; secretos cifrados; sin material sensible en `tmp`.
**Gate:** `validate` verde + checklist de homologación firmado + verificación del QR contra el verificador de AFIP.
**Ejes:** E2 10→15, E8 (secretos) +1.

### M2 — Tienda Nube productivo y omnicanal · Δ+4 · ~1–2 semanas
**Alcance:** de "espejo de stock en un sentido" a integración confiable y bidireccional.
- Validar **OAuth + webhook contra una URL HTTPS real** de staging (TN no acepta localhost).
- **Anti-pérdida de ítems:** orden con SKU no mapeado va a **bandeja de cuarentena** (no se importa parcial en silencio).
- **Bidireccional:** empujar a TN estado de envío/tracking y precio; usar la cola `failed_syncs` ya creada (migración 021) con reintentos visibles.
- **Auto-vinculación por SKU** (en vez de cargar IDs a mano) y **registro automático de webhooks** al conectar.

**DoD:** una tienda real conectada importa y reconcilia sin pérdidas; stock y estado fluyen en ambos sentidos; reintentos visibles; cero IDs cargados a mano.
**Gate:** `validate` verde + prueba e2e de pedido real TN → ERP → fulfillment → TN.
**Ejes:** E3 8→12.

### M3 — Operación, WMS y calidad de mercadería · Δ+5 · ~1,5–2 semanas
**Alcance:** cerrar el modelo operativo del depósito y compras.
- **QC bloqueante:** mercadería recibida entra a **cuarentena/ubicación bloqueada** hasta aprobar calidad (aprovechar el `QualityCheckDialog` ya iniciado).
- **Compras:** separar **solicitud/OT interna → aprobación → envío a proveedor** (hoy "aprobar" = "enviar").
- **Trazabilidad por producto desde la ficha** + **ubicaciones** + **eventos de envío** en el timeline (`label_created`, `in_transit`, `delivered`, `failed_delivery`).

**DoD:** stock defectuoso no queda disponible sin aprobación; flujo de compra con responsables claros; timeline cruza envío/recepción.
**Gate:** `validate` verde + recorrido QA de recepción→calidad→stock y de OT→OC→recepción.
**Ejes:** E4 10→12, E5 7→10.

### M4 — Finanzas operativas y bandejas de excepción · Δ+4 · ~1–1,5 semanas
**Alcance:** convertir saldos y errores en trabajo visible y conciliable.
- **Conciliación por medio de pago** en Cobranzas/Cuentas Corrientes (pantallas ya existentes); exportación/resumen.
- **Bandejas de excepción:** factura POS fallida tras venta guardada (reintento/reimpresión), cobros/pagos pendientes.
- **Cierre de caja** validado contra ventas/cobros del turno con diferencias auditables.

**DoD:** un operador sabe en una pantalla qué cobrar, qué pagar y qué está conciliado; ninguna venta queda sin factura sin que aparezca en una bandeja.
**Gate:** `validate` verde + QA de cobranza mixta/parcial y de recuperación de factura POS.
**Ejes:** E6 10→12, E1 13→15.

### M5 — Calidad técnica, observabilidad y operación · Δ+3 · ~1–1,5 semanas
**Alcance:** sostener el 100 en el tiempo.
- **e2e smoke crítico** (login→venta→factura→stock→TN) en CI; **cobertura backend** sobre servicios fiscales/financieros.
- **Descomponer archivos núcleo** (`sales.service.js` ~1.409 líneas; páginas 800+).
- **Observabilidad:** logging estructurado + monitoreo de errores; **backups automáticos** de BD; runbook de restauración.
- **Higiene de repo:** sacar snapshots/zip/logs del control de versiones.

**DoD:** CI corre e2e + unit en cada push; alertas de error activas; backup probado con restore; sin archivos núcleo monolíticos.
**Gate:** pipeline verde con e2e + reporte de cobertura + prueba de restore.
**Ejes:** E7 11→12, E8 10→12.

---

## 4. Resumen de avance por milestone

| Milestone | Δ | Acumulado | Foco |
|---|---:|---:|---|
| Base | — | 73 | Estado auditado |
| M0 Recuperación + baseline verde | +4 | 77 | Asegurar activo, gate verde |
| M1 Fiscal AFIP producción | +7 | 84 | Emitir legalmente |
| M2 Tienda Nube productivo | +4 | 88 | Omnicanal sin pérdidas |
| M3 Operación/WMS/Calidad | +5 | 93 | Depósito y compras |
| M4 Finanzas operativas | +4 | 97 | Cobranza y excepciones |
| M5 Calidad/Observabilidad | +3 | **100** | Sostenibilidad |

**Ventana estimada:** ~6–9 semanas de trabajo enfocado (1 dev full-time), con M0 ejecutable hoy.

---

## 5. Reglas de gobierno (para no retroceder)

- **Commit por lote** y push diario; nunca más de un día de trabajo sin versionar.
- **Ningún merge sin `npm run validate` verde** + QA del flujo afectado.
- **Lo fiscal se valida en homologación** antes de tocar producción.
- **Definition of Done** explícita por tarea; "pendiente validar" no es "hecho".
- **Secretos siempre cifrados**; nunca material sensible en `tmp` ni en logs.

---

## 6. Acción inmediata

1. Ejecutar `scripts/recover-and-validate.ps1` (asegura el trabajo y restablece el baseline verde) → cierra M0.
2. Confirmar el resultado real de `npm run validate` y `npm audit`.
3. Arrancar M1 (Fiscal AFIP) como primer bloque de valor.

*Este documento es la fuente de verdad del camino a 100/100 y reemplaza los planes dispersos previos. Se actualiza al cierre de cada milestone.*
