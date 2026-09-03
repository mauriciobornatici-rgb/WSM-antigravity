# Checklist de entrega

## Gates por superficie

| Superficie | Evidencia mínima |
|---|---|
| `packages/common` | build de contratos y consumidores tipados |
| Backend | pruebas dirigidas y suite completa del servidor |
| Frontend | lint, typecheck, pruebas y build |
| Migraciones | prueba de migración, integridad referencial y plan de recuperación |
| UI operativa | verificación en navegador del flujo principal y consola sin errores |
| Seguridad/RBAC | auditoría de seguridad y smoke de permisos |
| Stock/dinero | prueba transaccional, reintento/idempotencia y cancelación/reversión |

Ejecuta `npm run audit:engineering` cuando exista el comando. Los hallazgos críticos bloquean el cierre; los demás deben corregirse o quedar aceptados con fundamento en la bitácora.

## Entrada de bitácora

Registra:

- Fecha, objetivo y alcance.
- Decisiones e invariantes protegidas.
- Archivos y migraciones.
- Pruebas/comandos con resultado real.
- Riesgos conocidos y datos de prueba creados.
- Commit, si se realizó.
- Próximo paso exacto.

No copies secretos, tokens, contraseñas ni contenido de `.env`.
