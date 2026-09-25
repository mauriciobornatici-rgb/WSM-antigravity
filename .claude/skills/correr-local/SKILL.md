---
name: correr-local
description: Levanta WSM SportsERP en local de forma segura (sin tocar la DB de producción) para probar un cambio en el navegador. Úsalo cuando haya que ver la app funcionando, no solo tests.
---

**Peligro:** `.env` y `.env.development` apuntan a la DB de **producción**, y arrancar el servidor ejecuta migraciones. Nunca uses `npm run server`, `npm run dev:all` ni `node packages/server/index.js` sin `ENV_FILE=.env.local`. El servidor además se niega a arrancar contra un host no local fuera de producción salvo `ALLOW_REMOTE_DB=true`.

1. Usá `scripts/dev-local.ps1` si existe (revisá primero qué hace). Si no:
2. MySQL local en Docker (contenedor `wsm_local_db`, `127.0.0.1:3319`), iniciado con `--skip-log-bin --log-bin-trust-function-creators=1` (los triggers de las migraciones lo exigen).
3. Backend: `$env:ENV_FILE='.env.local'; node packages/server/index.js` (puerto 3001). La primera vez `.env.local` necesita `ADMIN_DEFAULT_PASSWORD` fuerte.
4. Frontend: `npm run dev` (Vite 5173).
5. "Failed to fetch" en login = el backend no está corriendo.

Para pruebas automatizadas contra MySQL usá los comandos `qa:*` (DB `wsm_qa` en 127.0.0.1:33308, `docker-compose.test.yml`), nunca los `smoke:*`/`preflight:*` sin prefijo.
