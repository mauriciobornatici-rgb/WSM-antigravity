---
name: project-bootstrap
description: >-
  Use this skill when onboarding into a new or existing workspace, running initial preflight checks, and ensuring context and quality files are properly configured.
---

# Skill: Project Bootstrap & Onboarding

Esta habilidad guía al agente en la inicialización o normalización de un proyecto dentro de Google Antigravity.

---

## Procedimiento de Inicialización

### Paso 1: Inspección de Entorno
1. Comprueba si existen archivos de configuración (`package.json`, `requirements.txt`, `pom.xml`, `go.mod`, etc.).
2. Identifica si el repositorio es un monorepo o un paquete individual.
3. Detecta scripts de validación existentes:
   - Compilación / Build (`build`, `compile`)
   - Verificación de tipos (`typecheck`)
   - Linters / Formateadores (`lint`, `format`)
   - Suites de pruebas (`test`, `test:unit`, `test:integration`)

### Paso 2: Validación de la Capa `.agents/context/`
1. Revisa si `.agents/context/PROJECT.md` tiene definido el objetivo real.
2. Comprueba que `.agents/context/QUALITY.md` tenga los comandos reales detectados en el Paso 1.
3. Verifica que `.agents/context/PROFILE.md` refleje el tipo de proyecto (`software`, `data`, `writing-research`).

### Paso 3: Ejecución del Preflight Rápido
1. Ejecuta el comando rápido más determinante (por ejemplo: `npm run typecheck` o `npm test`).
2. Si el preflight pasa con éxito:
   - Registra el estado en `.agents/context/TASKS.md`.
   - Comunica al usuario en menos de 10 líneas el resumen del diagnóstico.
3. Si el preflight falla:
   - Informa los errores detectados de forma concisa.
   - Solicita confirmación antes de aplicar correcciones de configuración si no estaban en el plan original.
