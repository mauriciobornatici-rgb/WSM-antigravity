# Contrato de Calidad y Verificación — WSM SportsERP

Este archivo define los comandos y criterios deterministas de verificación para el monorepo de WSM SportsERP.

---

## 1. Validaciones Rápidas (Fast Checks)

Ejecutar durante la iteración y antes de cada commit o paso:

### Frontend (`@wsm/client`):
```bash
npm -w @wsm/client run lint
npm -w @wsm/client run typecheck
npm -w @wsm/client run test
```

### Backend (`@wsm/server`):
```bash
npm -w @wsm/server run test
```

### Tipos compartidos (`@wsm/common`):
```bash
npm run build:common
```

---

## 2. Validaciones Integrales (Full Checks)

Ejecutar obligatoriamente antes de dar por completada una tarea o realizar entrega:

```bash
# Validación completa del monorepo (build common + test server + lint client + typecheck + test client + build client)
npm run validate

# Verificación de integridad relacional en BD (comprueba que no existan registros huérfanos)
npm run preflight:integrity

# Comprobación de matriz RBAC e inyección de datos
npm run smoke:rbac
```

---

## 3. Matriz de Evidencia de Aceptación

| Requerimiento | Comando de Verificación | Criterio de Éxito |
| :--- | :--- | :--- |
| Tipado estricto TypeScript | `npm run typecheck` | Salida limpia `exit 0` en common y client |
| Linter y estilo | `npm run lint` | 0 errores en frontend y backend |
| Tests unitarios del backend | `npm run test:server` | 375+ tests pasando |
| Cobertura de backend | `npm run test:coverage` | >90% líneas, ramas y funciones |
| Tests del cliente | `npm run test:client` | 47+ tests pasando |
| Integridad de claves foráneas | `npm run preflight:integrity` | 36 relaciones sin huérfanos |
| Matriz de roles y permisos | `npm run smoke:rbac` | 12/12 verificaciones aprobadas |
| Build de producción | `npm run build` | Bundle generado en `dist` sin warnings críticos |

---

## 4. Verificaciones que Requieren Revisión Humana

- Comprobación visual de responsividad móvil en interfaces a 320 px (p.ej. picking y conteo de stock).
- Pruebas con hardware físico (escáner Bluetooth / USB o cámara del móvil vía HTTPS).
- Validación de certificados y credenciales de producción para ARCA/AFIP y Tiendanube.

---

## 5. Preflight Rápido de Sesión

Comando estándar que el agente puede ejecutar al inicio de la sesión para validar la salud del workspace:
```bash
npm run typecheck
```
