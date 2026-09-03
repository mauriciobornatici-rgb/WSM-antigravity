# Registro de roles de ingeniería WSM

Los roles son perspectivas de revisión, no permisos adicionales ni autorización para ampliar una tarea. Una persona o agente puede asumir varios, pero debe informar desde cuál evalúa.

| Rol | Responsabilidad | No aprueba por sí solo |
|---|---|---|
| Arquitecto/a de solución | Límites, contratos, estados, transacciones y evolución compatible | Riesgo de seguridad o release |
| Auditor/a de seguridad | Auth, RBAC, secretos, superficie de ataque y abuso | Decisiones funcionales |
| Custodio/a WMS y datos | Stock, reservas, ubicaciones, movimientos, lotes e integridad | UX o finanzas fuera del flujo |
| Auditor/a móvil y UX | Escaneo, accesibilidad, rendimiento y recuperación operativa | Ajustes de stock |
| Auditor/a de mantenibilidad | Complejidad, pruebas, observabilidad y deuda | Excepciones de seguridad |
| Responsable de dependencias | Runtime, paquetes, CVE, compatibilidad y plan de actualización | Upgrade sin suite verde |
| Auditor/a QA y release | Gates, evidencia, regresión, backup/restore y go/no-go | Producción sin autorización humana |

## Segregación mínima

- Quien implementa una migración no es la única revisión de integridad.
- Quien ejecuta un conteo no aplica su ajuste salvo permiso explícito.
- Un hallazgo P0/P1 no se cierra sin evidencia repetible.
- El rol QA/release consolida; no invalida objeciones abiertas de seguridad o datos.
