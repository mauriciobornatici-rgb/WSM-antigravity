# Incorporación de Base Codex 2.0.0

Origen local: `C:\Dev\Base codex`. Fecha: 2026-09-06.
Se incorporó información de la plantilla mediante copia y adaptación selectiva.
El original no se modificó. No se ejecutó su instalador sobre el ERP.

## Mapa de adaptación

| Origen en Base Codex | Destino o tratamiento WSM | Motivo |
|---|---|---|
| template/PLANS.md | [PLANS](../../PLANS.md) | Plan de esta revisión con criterios reales |
| template/.ai/ARCHITECTURE.md | [.agents/context/ARCHITECTURE.md](../../.agents/context/ARCHITECTURE.md) | Mapa real del monorepo |
| template/.ai/RISKS.md | [.agents/context/RISKS.md](../../.agents/context/RISKS.md) | Riesgos con evidencia y seguimiento |
| template/.ai/AUDIT.md | [.agents/context/AUDIT.md](../../.agents/context/AUDIT.md) | Distinguir revisión propia de auditoría independiente |
| template/.ai/STATE.md | [.agents/context/TASKS.md](../../.agents/context/TASKS.md) | Checkpoint breve, historial archivado |
| template/.ai/QUALITY.md | [.agents/context/QUALITY.md](../../.agents/context/QUALITY.md) | Comandos existentes y alcance exacto |
| template/.ai/PROJECT.md y DECISIONS.md | Documentos canónicos existentes | Corrección factual y decisión de adaptación |
| template/.codex/agents/*.toml | [.codex/agents](../../.codex/agents/codebase-explorer.toml) | Cinco perfiles copiados y especializados en WSM |
| template/.codex/config.toml | [.codex/config.toml](../../.codex/config.toml) | Límite de dos especialistas; modelo/esfuerzo heredados |
| docs/OPERATING_MODEL.md y LARGE_PROJECTS.md | [OPERATING_MODEL](OPERATING_MODEL.md) | Continuidad, roles y un escritor por área |
| docs/AUDIT_PROTOCOL.md | [AUDIT_PROTOCOL](AUDIT_PROTOCOL.md) | Revisión proporcionada a riesgo y autorización existente |
| template/AGENTS.md | No reemplazado | La raíz ya tiene reglas específicas vigentes |
| docs/MODULE_AGENTS.example.md | No activado | No introducir nuevas reglas constitucionales por copia |
| scripts/Initialize-CodexProject.ps1 | Inspeccionado; no ejecutado | Omite archivos existentes; no fusiona ni resuelve duplicación |
| scripts/Test-CodexTemplate.ps1 | Ejecutado sobre el original | Valida estructura del kit, no comportamiento ni calidad del ERP |
| PROMPT_INICIO.md / START_HERE.md | Guía en [README](README.md) | Evitar otro punto de inicio con marcadores ficticios |

## Compatibilidad y configuración

Se verificó la documentación oficial de [subagentes](https://learn.chatgpt.com/docs/agent-configuration/subagents)
y [configuración](https://learn.chatgpt.com/docs/config-file/config-reference).
Los archivos TOML de agentes permiten nombre, descripción e instrucciones;
las configuraciones locales dependen de la confianza del proyecto.

Se omitieron los `model_reasoning_effort` fijos del original, el encendido explícito
de agentes y el ajuste del tamaño máximo de instrucciones.
El límite elegido es dos subagentes simultáneos; no obliga a ejecutarlos.
No se cambiaron confianza, permisos globales, modelo, proveedores ni credenciales.
Los perfiles de revisión restringen su sandbox a solo lectura.

Validar TOML demuestra sintaxis y estructura; no demuestra que una sesión en
curso haya recargado los especialistas ni que estos hayan auditado el proyecto.

## Historial y reversión

Las copias anteriores de `.ai/`, TASKS y STATE se preservaron en
[archivo histórico](../execution/archive/base-codex-2026-09-06/README.md).
Se conservaron los cambios funcionales que ya estaban en el workspace.
Para revertir esta adaptación, restaurar solo sus documentos desde esas copias
y retirar sus archivos nuevos de documentación/configuración; revisar el diff.
No restablecer el repositorio completo.
