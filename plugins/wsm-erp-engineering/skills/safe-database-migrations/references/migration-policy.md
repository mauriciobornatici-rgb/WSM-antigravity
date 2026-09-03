# Política de migraciones

## Secuencia

1. Inventariar tabla, volumen, nulos, duplicados, FKs e índices.
2. Agregar estructura compatible y nullable cuando el backfill lo requiera.
3. Poblar en lotes deterministas o mediante SQL idempotente.
4. Verificar conteos, huérfanos y sumas de control.
5. Agregar restricciones sólo después de datos válidos.
6. Mantener lectura/escritura compatible durante la transición.

## Recuperación

- DDL aditivo: documentar cómo ignorar o retirar la nueva superficie.
- Backfill: conservar clave de correlación y consulta de verificación.
- Renombre/eliminación: requiere fase separada, backup/restore ensayado y autorización.
- Nunca uses `DROP`, `TRUNCATE` o reasignaciones masivas implícitas como mecanismo de corrección.

## Gates

- Arranque sobre esquema ya migrado y sobre snapshot anterior.
- Suite backend y preflight de integridad referencial.
- Prueba de reejecución del runner sin aplicar dos veces.
- Evidencia de que sumas de stock, reservas y movimientos se conservan cuando esas tablas cambian.
