# Perfil Activo — WSM SportsERP

## Perfil Seleccionado
`software` (con especialización en ERP comercial, logística WMS y contabilidad)

## Justificación del Perfil
WSM SportsERP es un sistema de gestión empresarial en desarrollo con gates de preproducción pendientes, implementado como monorepo mixto (React/TypeScript frontend + Express/JavaScript backend + MySQL). Requiere control riguroso de tipos, integridad de transacciones contables y validación continua mediante suites automatizadas.

## Reglas Obligatorias del Perfil
- Inspeccionar la estructura de monorepo y types antes de cualquier modificación.
- Prohibir stock negativo en cualquier operación logística o comercial.
- Prohibir modificaciones destructivas (`DELETE`/`UPDATE`) sobre el libro mayor contable; usar contra-asientos.
- No delegar revisiones a otros modelos LLM si el código ya está cubierto por pruebas deterministas locales.
- Ejecutar `npm run validate` y `npm run preflight:integrity` antes de declarar tareas completadas.

## Riesgos Específicos del Proyecto
- Regresiones en la matriz de permisos RBAC.
- Corrupción de consistencia en reservas de stock durante el picking o conteos cíclicos.
- Desviación de tipos entre cliente y servidor (mantener siempre actualizado `@wsm/common`).
