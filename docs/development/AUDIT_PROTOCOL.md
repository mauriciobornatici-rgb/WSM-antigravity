# Protocolo de revisión para WSM

Adaptado de `Base codex/docs/AUDIT_PROTOCOL.md`.
Describe la revisión técnica; las reglas de aprobación y cierre vigentes están
en [AGENTS.md](../../AGENTS.md) y [QUALITY](../../.agents/context/QUALITY.md).

## Paquete mínimo

Objetivo, criterios, diff delimitado, archivos previos ya modificados, checks con
resultados, entorno de ejecución y riesgos conocidos. No incluir secretos ni
conversaciones completas.

## Revisión según el cambio

- Documentación reversible: comprobar referencias, hechos, alcance y conservación.
- Contratos o módulos múltiples: revisar productores, consumidores y pruebas negativas.
- Stock, dinero, permisos o concurrencia: revisar locks, límites transaccionales,
  reintentos, trazabilidad y recuperación con datos aislados.
- Cuando corresponda y esté autorizado, encargar una revisión independiente de
  solo lectura. Preparar perfiles no cuenta como haber ejecutado esa revisión.

## Evidencia de cierre

Registrar en [AUDIT](../../.agents/context/AUDIT.md):
resultado, hallazgo, ubicación, evidencia, impacto, recomendación y estado.

Usar resultados distintos:
- `pass`: criterio demostrado.
- `fail`: criterio contradicho.
- `blocked`: no se pudo ejecutar o completar por el entorno.
- `not_run`: no se realizó.

No convertir un bloqueo en aprobación ni usar conteos de tests como porcentaje
de calidad. Un hallazgo funcional puede quedar abierto en una entrega de
análisis; debe seguir visible antes de cerrar su corrección o autorizar una release.
La revisión del coordinador no debe rotularse auditoría independiente.
