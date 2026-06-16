# Auditoría Técnica de Estado — WSM SportsERP

**Fecha:** 15 de junio de 2026
**Tipo:** Auditoría empírica de estado (build, tests, dependencias, control de versiones, seguridad, calidad).
**Método:** verificación instrumental con cruce de fuentes. Ver §1 (alcance y confiabilidad).

---

## 0. Resumen ejecutivo

El **código fuente está sano y, de hecho, más avanzado** que en el último análisis: dos de los riesgos críticos previos ya están corregidos en el árbol de trabajo (el CAE falso de AFIP y la falta de cola de reintentos de Tienda Nube). El problema dominante hoy **no es el código, es el proceso**: hay **semanas de trabajo sin versionar** y un entorno de dependencias con **vulnerabilidades conocidas de severidad alta/crítica**.

| # | Hallazgo | Severidad | Confianza |
|---|---|---|---|
| H1 | ~3 semanas de trabajo **sin commitear** (5 migraciones + ~64 archivos nuevos + 130 modificados); último commit 25-may | **Crítica (operacional)** | Alta (git) |
| H2 | **25 vulnerabilidades** de dependencias (4 críticas, 14 altas), incl. RCE en react-router | **Alta** | Media-alta (npm audit) |
| H3 | Credenciales reales (DB pública, `JWT_SECRET`) en `.env` local; secretos AFIP/TN sin cifrar en BD | **Alta** | Alta |
| H4 | Tests y build **no verificables de forma fiable en esta sesión** (entorno de shell inestable + `node_modules` de otra plataforma) | **Media (riesgo de validación)** | Alta |
| H5 | Archivos núcleo muy grandes (`sales.service.js` ~1.409 líneas; varias páginas 800+) | **Baja-media** | Alta |
| ✓ | CAE falso de AFIP **corregido**; cola `failed_syncs` de Tienda Nube **implementada** | Mejora | Alta (lector + migraciones) |

**Veredicto:** el producto sigue su trayectoria de maduración y resolvió deuda crítica previa, pero está en un **estado frágil de entrega**: sin checkpoints de git, con dependencias vulnerables y sin una corrida verde reproducible. **Antes de cualquier otra cosa: commitear y asegurar el trabajo.**

---

## 1. Alcance y confiabilidad de la evidencia (importante)

Esta auditoría se ejecutó sobre el repositorio en `WSM Tienda Deportes`. Durante el trabajo detecté que **el entorno de shell de esta sesión devolvía copias truncadas o con bytes nulos de varios archivos del backend recién guardados** (p. ej. `sales.service.js`, `afip.service.js`, `index.js`). Crucé cada caso con el **lector de archivos** (que accede a los archivos reales por otra ruta) y con **git**, y confirmé que **los archivos reales están intactos y completos**: la discrepancia es un artefacto del montaje del shell, **no** corrupción de tu código.

Consecuencia metodológica, declarada con honestidad profesional:

- **Confiable** (lector de archivos + metadatos de git): contenido del código, historial de commits, alcance de cambios sin versionar, esquema de migraciones, higiene de `.env`.
- **Confianza media** (basado en versiones de `package-lock`): el reporte de vulnerabilidades `npm audit`.
- **No verificable de forma concluyente en esta sesión**: el resultado real de `npm test` y `npm run build`. El shell servía archivos corruptos y, además, el `node_modules` presente fue instalado en otra plataforma (falta el binario nativo `@rollup/rollup-linux-x64-gnu`), lo que impide correr Vitest/Vite aquí. Esto **no** indica un defecto del código; indica que la validación debe correrse en un entorno limpio (ver §7).

> Nota colateral: que un archivo se leyera truncado por una vía de E/S es, en sí mismo, un argumento a favor de H1 — el trabajo que vive **solo** en el árbol de archivos, sin commit, es el más expuesto.

---

## 2. Estado del repositorio y control de versiones — **H1 (Crítico operacional)**

| Métrica | Valor | Fuente |
|---|---|---|
| Rama | `main` | git |
| Último commit | `39571f7` — *"feat: tienda nube oauth2 and webhooks integration"* — **25-may-2026** | git |
| Cambios sin commitear | **130 modificados + 64 nuevos + 57 borrados = 251** | git status |
| Migraciones en HEAD | hasta `016_add_tiendanube_oauth_fields` | git ls-tree |
| Migraciones en disco | hasta `021_create_tiendanube_failed_syncs` | disco |
| **Migraciones sin commitear** | **017, 018, 019, 020, 021** (5) | cruce |

Hay **~3 semanas de desarrollo sustancial sin un solo commit**. Entre lo que existe solo en el árbol de trabajo:

- **5 migraciones de esquema** (facturas de proveedor, `supplier_id`, estado de integración TN, pagos de factura proveedor, **`failed_syncs` de Tienda Nube**).
- **Módulos/áreas nuevas completas** (archivos *untracked*): `Collections.tsx`, `CurrentAccounts.tsx`, `SupplierPayments.tsx`, `QualityCheckDialog.tsx`, `TraceabilityPanel.tsx`, componentes de `accounting/`, pestañas de `returns/`, `supplierInvoiceController.js`, `common/schemas/erp.ts`, entre otros.
- Las **correcciones de los dos riesgos críticos** del análisis previo (ver §4).

**Riesgo:** un único incidente en el directorio de trabajo (sync, borrado, corrupción de FS, error de `git checkout`) borraría semanas de trabajo **sin posibilidad de recuperación desde el historial**. No hay punto de restauración intermedio entre el 25-may y hoy. Además observé un `.git/index.lock` que no pudo removerse y lecturas truncadas: señales compatibles con un **filesystem sincronizado/inestable** (OneDrive/Dropbox/red), el peor lugar para alojar un repo activo.

**Acción inmediata (P0):**
1. `git add -A && git commit` ahora (aunque sea WIP), o al menos `git stash`/branch de respaldo.
2. Empujar a un remoto (push) para tener copia fuera de la máquina.
3. Mover el repositorio **fuera de carpetas sincronizadas** (OneDrive/Dropbox) a una ruta local dedicada.
4. Adoptar cadencia de commits por lote de trabajo (ya está como regla en `BITACORA_INTEGRAL.md`; falta cumplirla).

---

## 3. Seguridad de dependencias — **H2 (Alta)**

`npm audit` reporta **25 vulnerabilidades: 1 baja, 6 moderadas, 14 altas, 4 críticas**.

**Críticas** (en su mayoría herramientas de build/dev): `vitest`, `concurrently`, `shell-quote`, `basic-ftp`.

**Altas que impactan runtime de producción:**

| Paquete | Riesgo | Nota |
|---|---|---|
| `react-router` / `react-router-dom` | **RCE** vía `turbo-stream`, XSS, open-redirect, CSRF, DoS | Frontend en versión 7.x vulnerable |
| `express-rate-limit` | Alta | **Se usa como control de seguridad** (limita login); debilita una defensa propia |
| `undici` / `form-data` | Alta | Cliente HTTP usado por integraciones (axios/afip/TN) |
| `path-to-regexp` | Alta (ReDoS) | Routing Express |
| `ws`, `lodash`, `esbuild`, `vite`, `rollup` | Alta | Cadena de build y utilidades |

**Acción (P1):** correr `npm audit fix` (la mayoría tiene fix no disruptivo), revisar manualmente el salto mayor de `react-router-dom` y re-validar la suite tras actualizar. *Confirmar el conteo con un `npm audit` local, ya que aquí se leyó vía el montaje.*

---

## 4. Evolución desde el análisis previo (estado actual del código)

Verificado con el lector de archivos y el listado de migraciones — **buenas noticias, el árbol actual corrige deuda crítica:**

- **AFIP — CAE falso eliminado.** `afip.service.js` ahora expone un método dedicado `authorizeVoucher()` que devuelve `cae = afipRes ? afipRes.cae : null` (antes se generaba un número aleatorio de 14 dígitos como CAE). La lógica de recuperación *split-brain* se centralizó en el servicio AFIP, reduciendo la duplicación que existía entre ventas y garantías. **(Riesgo C1 del informe anterior: resuelto en el árbol de trabajo.)**
- **Tienda Nube — cola de reintentos.** Existe la migración `021_create_tiendanube_failed_syncs.sql` y la UI correspondiente en `TiendanubeSettingsTab.tsx` (372 líneas, con "Reintentar Todos" y bandeja de "sincronizaciones fallidas"). **(Riesgo A2 anterior: mitigado.)**
- **Bandejas operativas nuevas:** `Collections`, `CurrentAccounts`, `SupplierPayments`, y un `QualityCheckDialog` (control de calidad), justo las brechas que la propia review interna del 14-jun marcaba como faltantes.

Estas mejoras **aún no están commiteadas** (refuerza H1): el avance es real pero no está asegurado.

---

## 5. Seguridad de credenciales y configuración — **H3 (Alta)**

**Bien:** `.gitignore` ignora correctamente `.env` y `.env.*` (excepto `.env.example`). **No hay `.env` con secretos versionado** y no se hallaron secretos hardcodeados en el código (solo fixtures de test).

**A corregir:**
- El `.env` local (no versionado) contiene credenciales **reales**: `DB_HOST` apuntando a una **IP pública**, usuario/clave de MySQL de tipo hosting compartido, y un `JWT_SECRET` real, todo con `NODE_ENV=development`. Apuntar un entorno de desarrollo a una base accesible por IP pública es riesgoso; conviene base local para dev y rotar el secreto si estuvo expuesto.
- **Secretos en reposo sin cifrar** (persiste del informe anterior): certificado y **clave privada de AFIP**, `tiendanube_client_secret` y `access_token` se guardan como texto plano en `company_settings`. La clave AFIP además se escribe en el `tmp` del SO. Sigue siendo el riesgo de seguridad de mayor impacto a nivel datos.

---

## 6. Calidad de código y deuda técnica — **H5 (Baja-media)**

- **TypeScript del cliente: 0 errores** (`tsc --noEmit`). Los contratos del frontend están limpios.
- **Volumen:** ~27.300 líneas en cliente, ~12.500 en servidor, ~600 en común (~40k total).
- **Archivos grandes / candidatos a refactor:** `sales.service.js` (~1.409 líneas), `procurementController.js` (~827), y páginas `Picking`/`Inventory`/`CurrentAccounts` (800+). No es un defecto, pero concentra complejidad y dificulta el testeo unitario.
- **Deuda explícita baja:** prácticamente sin `TODO/FIXME` reales (el único relevante: envío de comprobantes por email pendiente de endpoint real, en `Invoices.tsx`). 
- **Higiene:** se está eliminando la carpeta `deprecated/` (57 borrados) — bien; conviene además sacar del repo `recovery-snapshot-*.zip` y `logs/`.

---

## 7. Verificación pendiente (requiere entorno limpio) — **H4**

No pude obtener una corrida verde reproducible en esta sesión por (a) el montaje de shell inestable y (b) `node_modules` instalado para otra plataforma (falta `@rollup/rollup-linux-x64-gnu`). Para cerrar la auditoría con datos de ejecución reales, en una máquina/entorno limpio:

```bash
# en una ruta local NO sincronizada, tras commitear
rm -rf node_modules package-lock.json   # opcional si hay líos de optional deps
npm install
npm run validate     # build common + test server + lint + test client + build
npm audit            # confirmar el conteo de vulnerabilidades
```

`npm run validate` ya está definido como secuencia canónica en el `package.json` raíz; es el árbitro objetivo del estado "verde".

---

## 8. Plan de remediación priorizado

**P0 — Asegurar el trabajo (hoy)**
1. Commit + push de todo el árbol (o stash/branch de respaldo) — H1.
2. Mover el repo fuera de carpeta sincronizada; eliminar `.git/index.lock` huérfano si reaparece.

**P1 — Validar y endurecer (esta semana)**
3. `npm install` limpio + `npm run validate` en entorno nativo; registrar resultado real de tests/build — H4.
4. `npm audit fix` y revisión del major de `react-router-dom`; re-validar — H2.
5. Base local para desarrollo y rotación de `JWT_SECRET`/credenciales si hubo exposición — H3.

**P2 — Robustez y mantenibilidad**
6. Cifrado de secretos en reposo (AFIP/TN) y manejo de la key AFIP sin texto plano en `tmp` — H3.
7. Descomponer `sales.service.js` y las páginas de 800+ líneas; subir cobertura de tests del backend — H5.
8. Sacar del control de versiones snapshots/zip y logs.

---

## 9. Conclusión

El código de WSM SportsERP está **sano y en mejor estado que en la revisión anterior**: resolvió el CAE falso y sumó la cola de reintentos de Tienda Nube, control de calidad y bandejas de cobranza/cuenta corriente. La amenaza real al proyecto hoy es de **gestión de entrega**, no de arquitectura: semanas de trabajo valioso viven sin commitear sobre un filesystem que dio señales de inestabilidad, y la cadena de dependencias arrastra vulnerabilidades conocidas. Cerrando H1 (commit/push) y H2 (audit) y corriendo `npm run validate` en limpio, el proyecto vuelve a una base de entrega sólida y auditable.

---

*Auditoría sobre el estado del repositorio al 15/06/2026. Resultados de ejecución (tests/build) marcados como no concluyentes deben confirmarse en entorno limpio según §7.*
