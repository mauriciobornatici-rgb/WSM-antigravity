---
name: quality-verifier
description: >-
  Use this skill when verifying changes, executing deterministic test suites, running linters and typechecks, or preparing a task for completion sign-off.
---

# Skill: Quality Verifier

Esta habilidad guía al agente en la ejecución rigurosa de validaciones deterministas antes de dar por completada una tarea.

---

## Procedimiento de Verificación

### 1. Verificación en Ciclo de Desarrollo (Fast Check)
Tras modificar código o agregar una funcionalidad puntual:
1. Localiza el módulo o archivo modificado.
2. Ejecuta la prueba unitaria más cercana o el chequeo de tipos:
   ```bash
   # Ejecuta el chequeo configurado en .agents/context/QUALITY.md
   ```
3. Si surgen advertencias o errores de sintaxis/tipos, corrígelos de inmediato antes de proceder con el siguiente bloque.

### 2. Verificación de Cierre (Full Check)
Antes de declarar que la tarea concluyó satisfactoriamente:
1. Ejecuta la suite de pruebas completa y el linter:
   - Comprobación de tipos (`typecheck`)
   - Linter (`lint`)
   - Suite de pruebas (`test`)
   - Compilación (`build`)
2. Compara los resultados contra la *Matriz de Evidencia de Aceptación* en `.agents/context/QUALITY.md`.
3. Registra la evidencia objetiva en `.agents/context/TASKS.md` (fecha, hora, comando, resultado).
4. Si algún chequeo no pudo ejecutarse por limitaciones del entorno, decláralo abiertamente como limitación en lugar de ocultarlo.
