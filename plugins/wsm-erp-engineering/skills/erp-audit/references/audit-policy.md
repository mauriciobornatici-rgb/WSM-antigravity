# Política de auditoría

## Perfiles y responsables

- Seguridad: autenticación, autorización, secretos, inyección, exposición y abuso.
- Arquitectura: límites de dominio, fuentes de verdad, transacciones y contratos.
- Mantenibilidad: complejidad, duplicación, tamaño, errores silenciosos y cobertura conductual.
- Actualizaciones: runtime, dependencias, lockfile, acciones CI y cambios incompatibles.
- Mejores prácticas: accesibilidad, performance, observabilidad, UX operativa e idempotencia.

Los roles detallados están en `roles/ROLE_REGISTRY.md` del plugin.

## Severidad

- P0 crítica: pérdida/corrupción de datos, bypass de autorización, secreto expuesto o stock/dinero incorrecto explotable. Bloquea integración.
- P1 alta: fallo probable de operación crítica o control preventivo ausente. Bloquea release salvo aceptación explícita.
- P2 media: deuda que degrada confiabilidad o mantenibilidad. Planificar y asignar.
- P3 baja: mejora localizada sin riesgo operativo inmediato.

Cada hallazgo contiene evidencia, escenario, impacto, recomendación y método de verificación. Un scanner puede producir falsos positivos; valida antes de afirmar.

## Gates

- Cambios de auth/RBAC/secretos: seguridad obligatoria.
- Cambios de stock/dinero/migraciones: seguridad + arquitectura.
- Múltiples componentes React: mantenibilidad + mejores prácticas.
- Actualización de paquetes/runtime: actualizaciones + seguridad + suite completa.
- Release: todos los perfiles y auditoría de dependencias con red disponible.
