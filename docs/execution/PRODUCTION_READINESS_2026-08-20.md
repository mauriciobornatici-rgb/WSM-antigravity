# Readiness de preproducción y producción — 2026-08-20

## Dictamen

El código queda listo para desplegar en **preproducción**. No corresponde declarar todavía un go-live de producción: faltan gates de infraestructura y ensayos con servicios reales. Las credenciales ARCA y Tiendanube quedan deliberadamente para la última etapa, como decisión del proyecto.

## Evidencia cerrada

- Backend: 118/118 pruebas; cobertura 61,64% líneas, 55,61% ramas y 68,17% funciones, por encima del piso bloqueante.
- Frontend: 42/42 pruebas, ESLint y TypeScript sin errores, build Vite correcto.
- RBAC/validación: 12/12 controles HTTP.
- Integridad: 4/4 contratos HTTP y 20/20 relaciones de base sin huérfanos.
- Migraciones `000` a `036` aplicadas en desarrollo y bootstrap idempotente.
- Recepción QA: aprobación bloqueada sin QC, QC completo aceptado, stock actualizado una sola vez y segundo intento bloqueado.
- Bajas lógicas de clientes y proveedores verificadas.
- Tiendanube centralizada en `Tienda online`; Configuración general ya no expone sus funciones.
- No se muestran acciones ficticias: el envío de factura por email permanece oculto hasta conectar un proveedor real.

## Gates pendientes antes de producción

1. **Infraestructura staging**: definir host, dominio HTTPS, proxy, `NODE_ENV=staging`, CORS y URL pública del backend.
2. **Datos y recuperación**: separar usuarios/contraseñas de DB para staging y producción, rotar la contraseña heredada, generar backup consistente y restaurarlo en un entorno aislado. En esta estación no está instalado `mysqldump`, por lo que el ensayo debe hacerse en el host elegido.
3. **Observabilidad**: conectar logs JSON y health checks a monitoreo con alertas de disponibilidad, latencia, errores 5xx, fallos de worker y espacio/backup.
4. **Pipeline**: exigir CI verde, incluido Chromium E2E y `npm audit --audit-level=high`. El control Playwright CLI no pudo ejecutarse localmente porque el entorno no dispone de `npx`.
5. **Operación controlada**: ejecutar caja con un turno abierto, picking, despacho, facturación no fiscal, cobranza, devolución, recepción/QC y reversión contable en staging.
6. **ARCA — última etapa**: cargar credenciales de homologación, probar certificado/clave, punto de venta, CAE, QR y nota de crédito. Recién después cargar producción.
7. **Tiendanube — última etapa**: configurar app y URLs HTTPS, OAuth con tienda de prueba, Location ID, webhooks, catálogo multivariante, pedido controlado, tracking y sincronización de stock. Seguir `docs/TIENDANUBE_OPERATIONS.md`.

El envío real de facturas por email no bloquea los circuitos actuales de impresión/descarga, pero debe tratarse como una funcionalidad separada si se define como requisito de salida; requerirá proveedor, dominio remitente y trazabilidad de entregas.

## Secuencia go/no-go

1. Crear staging con secretos exclusivos y una copia restaurada de la base.
2. Iniciar backend y verificar migraciones, `/api/live` y `/api/health`.
3. Ejecutar `npm run preflight:staging` con el backend ya iniciado.
4. Ejecutar CI completo y el smoke de caja con turno controlado.
5. Recorrer manualmente los roles admin, manager, cashier y warehouse.
6. Activar y validar ARCA homologación.
7. Activar y validar Tiendanube en tienda de prueba.
8. Revisar logs, alertas, backup restaurable y plan de rollback.
9. Autorizar producción sólo si todos los puntos anteriores están verdes.

## Criterios de no-go

- Backup sin restauración verificada.
- CI, auditoría, E2E o preflight en rojo.
- Secretos compartidos entre desarrollo y producción.
- Health check o alertas sin configurar.
- Emisión fiscal o sincronización Tiendanube no ensayadas en sus entornos de prueba.
- Migraciones modificadas después de aplicadas o datos huérfanos/duplicados sin resolución explícita.
