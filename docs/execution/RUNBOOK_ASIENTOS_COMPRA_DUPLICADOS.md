# Runbook — asientos de compra duplicados (histórico)

## Qué pasó

Hasta el commit `d221b12` (2026-09-25) cada compra se asentaba **dos veces**: al aprobar
la recepción de mercadería y al registrar la factura del proveedor (Mercadería + IVA
crédito fiscal / Proveedores). El libro quedó con inventario, IVA crédito y deuda con
proveedores duplicados. Desde ese commit solo asienta la factura (ADR-008).

El libro es inmutable: no se borran ni editan asientos. La corrección es un
**contra-asiento** por cada asiento de recepción duplicado, con el mecanismo estándar
del sistema (`reverseJournalEntry`: mismas cuentas con debe/haber invertidos, vínculo
`reversal_of_entry_id`, auditoría, imposible revertir dos veces).

## Clases

| Clase | Condición | Por defecto |
|---|---|---|
| `exact` | La factura del proveedor está vinculada a esa recepción (`reception_id`) y asentó | Se propone revertir |
| `probable` | Hay factura asentada de la misma orden de compra, sin vínculo directo (recepciones parciales: los montos pueden no coincidir) | Solo con `--include=probable` tras revisión |
| `pending_invoice` | Todavía no hay factura asentada: hoy el asiento de recepción es el único, pero cuando llegue la factura quedará duplicado | Solo con `--include=pending_invoice`, decisión del contador |

## Pasos (los ejecuta el usuario, con el contador)

1. Backup de producción verificado.
2. Desde `packages/server`, con el entorno de producción:

   ```powershell
   node scripts/diagnose-purchase-entry-duplicates.js --format=csv --out=compras-duplicadas.csv
   ```

   Solo lectura. El contador revisa cada fila y los contra-asientos propuestos.
3. Simulación (no escribe):

   ```powershell
   node scripts/reverse-purchase-entry-duplicates.js --out=reversion-simulada.json
   ```

4. Aplicar solo lo aprobado (por defecto clase `exact`; se puede restringir a asientos
   concretos con `--entries=<id,id>` o sumar clases con `--include=`):

   ```powershell
   node scripts/reverse-purchase-entry-duplicates.js --apply --confirm=<DB_NAME> --out=reversion-aplicada.json
   ```

5. Repetir el diagnóstico: los asientos revertidos ya no aparecen. Una segunda corrida no
   vuelve a revertir nada.

## Verificación hecha en QA

`npm run qa:integration` (6 casos: detección por clase, reversión balanceada con el
original intacto, idempotencia, diagnóstico sin escrituras) y corrida de los CLI en
`wsm_qa`: simulación, `--confirm` faltante rechazado (exit 2), aplicación y segunda
corrida sin cambios.
