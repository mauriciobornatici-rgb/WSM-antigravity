# Calidad y verificación — WSM SportsERP

Adaptación Base Codex actualizada el 2026-09-06. Las obligaciones de AGENTS/GEMINI
y los umbrales existentes se conservan. Ver [QA local](../../docs/development/QA.md).

## Comandos desde la raíz

| Comando | Alcance y límite |
|---|---|
| npm run build:common | Contratos compartidos; obligatorio tras DTO/RBAC |
| npm run typecheck | common + cliente; no tipado estático del backend JS |
| npm run lint | ESLint del cliente |
| npm run test:server | Runner aislado: node --test con DB127.0.0.1:1 y claves ficticias |
| npm run test:qa-guards | Guardas de entorno y servidor HTTP de pruebas |
| npm run test:client | Vitest del cliente |
| npm run validate | common, guards, backend aislado, lint/tipos/tests/build cliente |
| npm run test:coverage | Backend aislado con gate90 en líneas/ramas/funciones |
| npm run qa:bootstrap -- --allow-qa-bootstrap | Migraciones/fixtures solo en wsm_qa local; exige autorización de migraciones |
| npm run qa:preflight:integrity | El mismo preflight referencial con destino QA fijo |
| npm run qa:smoke:rbac | 12 casos HTTP en app efímera y MySQL QA |
| npm run qa:smoke:integrity | Smoke básico; no activa los tres circuitos opcionales |
| npm -w @wsm/client run test:e2e | Login con API simulada, Chromium y preview propio; requiere build |

test:isolated/test:coverage:isolated son alias explícitos de los wrappers.
Los comandos directos del workspace server, preflight:integrity y smoke:* sin
prefijo qa conservan la configuración de su entorno: revisar destino antes de usarlos.
El wrapper elimina secretos heredados y aplica NODE_ENV=development únicamente
al backend; no exportar ese valor globalmente para construir el cliente.

## Ciclo y cierre

Durante cambios: test dirigido. Al cierre: validate y preflight:integrity sobre
destino revisado (el alias qa:preflight:integrity ejecuta el mismo script), más
smokes aplicables. Para cierre integral usar cobertura y E2E; no reducir umbrales.
Registrar comando, entorno, resultado y límites en [AUDIT](AUDIT.md).

MySQL QA: docker-compose.test.yml, puerto127.0.0.1:33308, tmpfs, sin binlog ni
replicación. No sustituye pruebas de backups/PITR ni staging.
Los 42 SQL históricos mantienen sus checksums. El ejecutor adapta únicamente
sintaxis legacy reconocida; nuevas migraciones deben usar sintaxis MySQL válida.

## Resultado actual y pendientes

validate pasa (7 guards,431 backend,62 cliente); cobertura falla
81,23/88,82/73,98 %. MySQL bootstrap limpio/repetido, preflight, RBAC y E2E pasan.
CI incorpora esos gates, pero no se ejecutó remotamente; cobertura sigue bloqueante.
Pendientes: circuito completo POS→DB→contabilidad, concurrencia, caja/recepción,
impresión A4/80mm, escáner/cámara, backups, homologación ARCA y Tiendanube.
