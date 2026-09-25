# QA local y CI

Los comandos de QA usan dos destinos separados. Las pruebas unitarias y de
cobertura reciben `ENV_FILE=.env.example`, una base inexistente en `127.0.0.1:1`
y claves ficticias. No heredan `DB_HOST`, `DB_NAME`, secretos, proxies ni otros
valores de configuración del proceso que los invoca. `test:server` y
`test:coverage` usan el runner aislado por defecto; `test:isolated` y
`test:coverage:isolated` se conservan como alias explícitos para CI y uso local.
El runner valida el entorno antes de crear el proceso hijo y aplica
`NODE_ENV=development` únicamente a ese proceso backend. Por eso
`npm run validate` mantiene seguros sus tests de base de datos sin contaminar el
proceso que continúa con lint, typecheck, tests y build del cliente.

```powershell
npm run build:common
npm run test:qa-guards
npm run test:server
npm run test:coverage
```

La cobertura mantiene los umbrales existentes de 90% para líneas, ramas y
funciones. Un fallo de cobertura conserva código de salida distinto de cero.

## MySQL efímero para smokes

`docker-compose.test.yml` crea únicamente el contenedor `wsm_qa`, publica
`127.0.0.1:33308`, usa credenciales de prueba públicas y monta
`/var/lib/mysql` en tmpfs. El contenedor QA usa `--skip-log-bin` porque su
bootstrap efímero ejecuta triggers sin replicación habilitada. No comparte
volumen, red ni credenciales con staging/producción.

Este entorno no valida replicación, backup ni recuperación punto en tiempo
(PITR); esas capacidades requieren una configuración de infraestructura
separada.

```powershell
docker compose -f docker-compose.test.yml up -d --wait mysql
npm run qa:bootstrap -- --allow-qa-bootstrap
npm run qa:preflight:integrity
npm run qa:smoke:rbac
npm run qa:smoke:integrity
docker compose -f docker-compose.test.yml down -v --remove-orphans
```

El bootstrap exige la bandera `--allow-qa-bootstrap` y valida, antes de cargar
los módulos de migración o base de datos, `NODE_ENV=development`,
`ENV_FILE=.env.example`, un host loopback, el puerto `33308`, la base exacta
`wsm_qa`, el usuario QA y las credenciales ficticias. El seed de usuarios repite
la guarda y siempre cierra el pool; un error de consulta termina con código de
salida 1. No ejecutar migraciones contra otro destino para resolver un bloqueo.

Los wrappers `qa:smoke:*` pasan un entorno QA mínimo y fijan
`WSM_QA_MODE=1`. En ese modo `smoke-runner-helper.js` no sondea ni reutiliza un
servidor HTTP existente: importa la app después de validar el entorno y la
levanta en un puerto efímero sobre `127.0.0.1`.

## E2E de autenticación

Después de construir el frontend, Playwright inicia su propio preview en
`http://127.0.0.1:4173` con `--strictPort`; la configuración no apunta a rutas
locales de Chromium ni reutiliza un servidor previo.

```powershell
npm run build:common
npm run build
npm -w @wsm/client exec -- playwright install --with-deps chromium
npm -w @wsm/client run test:e2e
```

Los casos simulan la API de autenticación. El caso negativo comprueba el texto
real `Credenciales inválidas` renderizado por el flujo de errores, además de
verificar que permanece en `/login`.

## Evidencia y límites

El workflow de CI ejecuta Node 24, las guardas y la cobertura aislada con gate
90, Chromium oficial, y el job MySQL dedicado con bootstrap, preflight y RBAC.
El coordinador revisó las implementaciones y ejecutó Docker, instalación limpia,
bootstrap repetido, smokes, Playwright y controles locales. La cobertura sigue
por debajo de 90 % y bloquea su job. Ver los resultados y límites en
[evidencia de la entrega](../execution/MEJORAS_QA_2026-09-06.md).
No se ejecutó el workflow remoto ni se certificaron los circuitos opcionales de
recepción/caja, hardware, replicación o integraciones externas.
