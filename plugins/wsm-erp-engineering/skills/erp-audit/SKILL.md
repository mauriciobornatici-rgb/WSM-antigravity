---
name: erp-audit
description: Audita cambios o estado de WSM SportsERP en seguridad, arquitectura, mantenibilidad, dependencias y mejores prácticas, con evidencia y severidad. Úsala para revisiones, gates de entrega y preparación de releases.
---

# Auditoría integral WSM ERP

Lee [references/audit-policy.md](references/audit-policy.md). Ejecuta el perfil necesario mediante el MCP `wsm-engineering` o el CLI compartido; no sustituyas evidencia por una revisión verbal.

## Flujo

1. Define alcance: repositorio, diff, módulo o release.
2. Ejecuta snapshot y perfiles relevantes.
3. Confirma hallazgos contra el código; los patrones automáticos son señales, no veredictos.
4. Clasifica severidad e impacto empresarial.
5. Corrige sólo si la solicitud autoriza cambios; en una auditoría pura entrega el informe.
6. Repite el perfil y registra hallazgos resueltos, aceptados y pendientes.

Nunca muestres valores de `.env`, tokens, hashes de contraseñas o secretos. Informa únicamente tipo, ruta y ubicación segura del hallazgo.
