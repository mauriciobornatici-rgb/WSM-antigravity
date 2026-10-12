# Terminal móvil de depósito

- Mantén una superficie `/terminal` separada de `AppLayout`; la PC sigue siendo el centro administrativo.
- Módulos móviles: recepción/putaway, picking, auditorías y traslado.
- La seguridad depende de permisos backend, no de enlaces ocultos ni del ancho de pantalla.
- Flujo de escaneo: tarea/documento → ubicación → producto/variante → cantidad → confirmación del servidor.
- Botones de omisión requieren permiso excepcional, motivo y evento auditado.
- Cámara y PWA requieren HTTPS. Conserva lector Bluetooth/USB e ingreso manual como contingencia.
- Muestra conectado/reconectando/pendiente. Puede cachearse la tarea, pero cerrar o aplicar stock exige confirmación del servidor.
- Toda cola offline usa almacenamiento durable, orden, idempotencia y resolución explícita de conflictos.
- La PC debe ver operador, progreso, último evento y excepción mediante polling acotado o SSE.
