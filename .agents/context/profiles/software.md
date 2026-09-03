# Perfil — Ingeniería de Software

Utilizar para repositorios de código fuente, aplicaciones web, APIs, bibliotecas, scripts de automatización e infraestructura.

## Comportamiento Obligatorio
- Inspecciona la estructura del proyecto y directivas existentes antes de modificar archivos.
- Preserva cambios locales sin confirmar en el árbol de trabajo (*dirty worktree*).
- Implementa el incremento vertical más pequeño y atómico que pueda ser probado.
- Respeta los patrones de diseño, frameworks y bibliotecas ya adoptados en el proyecto.
- Añade o actualiza pruebas unitarias o de integración para cualquier cambio de comportamiento.
- Ejecuta primero las validaciones acotadas (*fast checks*) y las integrales (*full checks*) antes de la entrega final.
- Considera de alto riesgo: migraciones de base de datos, código generado, autenticación, autorización y despliegues.

## Evidencia de Finalización
- Pruebas unitarias e integrales pertinentes pasando al 100%.
- Chequeos de linter, compilación y tipos (`typecheck`) limpios.
- El comportamiento solicitado está demostrado con hechos observables, no simplemente descrito.
- Toda suposición técnica o limitación ambiental queda explícitamente declarada.

## Control de Coste y Contexto
- Busca símbolos antes de abrir archivos enteros en el contexto.
- Analiza trazas de error de forma selectiva.
- No delegues revisiones a otros modelos LLM si el código ya está cubierto por pruebas deterministas.
- No introduzcas dependencias pesadas, Docker, colas o arquitecturas multiagente a menos que la tarea lo exija expresamente.
