---
name: wms-logistics
description: Diseña, implementa o revisa inventario, ubicaciones, reservas, recepción, putaway, picking, traslados y auditorías de WSM SportsERP. Úsala cuando un cambio pueda alterar cantidad, disponibilidad o ubicación física.
---

# Logística WMS de WSM

Antes de actuar lee [references/invariants.md](references/invariants.md). Para interfaces de teléfono, cámara, tareas de depósito o sincronización PC-teléfono lee también [references/mobile-terminal.md](references/mobile-terminal.md).

## Resultado esperado

- `inventory` conserva la existencia física por producto y ubicación.
- Una reserva identifica exactamente el documento, artículo, fila de inventario y cantidad.
- Un escaneo sólo confirma trabajo después de validación en servidor.
- Cada cambio físico genera un movimiento trazable e idempotente.
- Cancelar, reintentar o retomar una tarea no duplica ni pierde unidades.
- El ajuste de auditoría permanece separado del conteo operativo.

Usa transacciones y bloqueos de fila para cada comando que combine reserva, inventario, movimiento o estado. Rechaza estados obsoletos con conflicto explícito; no uses “última escritura gana” en cantidades.

No tomes `products.location` como existencia real. Es una preferencia de ubicación; la realidad está en `inventory` y en las asignaciones persistidas.
