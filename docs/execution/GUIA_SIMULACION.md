# Guía de simulación de procesos — WSM SportsERP

Entorno de práctica para recorrer **todos los procesos** con datos de una tienda de deportes, sin tocar la base de desarrollo (`wsm_sports_erp`) ni la de producción. Usa una base aparte, `wsm_simulacion`, en el MySQL local de Docker.

## 1. Levantar y reiniciar

| Qué | Comando (PowerShell, desde la carpeta del proyecto) |
|---|---|
| Levantar la simulación (la crea si no existe) | `powershell -File scripts\simulacion.ps1` |
| Empezar de cero (borra y vuelve a cargar los datos y los movimientos) | `powershell -File scripts\simulacion.ps1 -Reiniciar` |
| Empezar de cero solo con datos maestros (caja cerrada, sin ventas ni pedidos) | `powershell -File scripts\simulacion.ps1 -Reiniciar -SinMovimientos` |
| Volver al entorno de desarrollo habitual | `powershell -File scripts\dev-local.ps1` |

La aplicación queda en **http://localhost:5173** y la API en el puerto 3001. Los dos entornos usan los mismos puertos: el script de cada uno cierra el otro antes de arrancar.

Si algo no arranca, los registros quedan en `%TEMP%\wsm_simulacion.out.log` y `%TEMP%\wsm_simulacion.err.log` (API) y en `%TEMP%\wsm_web.out.log` (aplicación web).

## 2. Usuarios

Contraseña de todos, solo para esta base de simulación: **`Simulacion2026!`**

| Usuario | Rol | Para probar |
|---|---|---|
| `admin@sports.store` | Administrador | Todo, incluida la configuración y la reemisión fuera de plazo |
| `gerente@simulacion.test` | Gerente | Excepciones del POS, cambios de precio y de envío, Caja 2 |
| `cajero@simulacion.test` | Cajero | Mostrador, caja, facturación, cobranzas, devoluciones |
| `deposito@simulacion.test` | Depósito | Recepciones, control de calidad, picking, conteos |

## 3. Datos cargados

- **Empresa:** WSM Deportes (simulación), Responsable Inscripto, punto de venta 1, ARCA en **homologación sin credenciales**.
- **Ubicaciones:** `DEP-A1` (depósito) y `SAL-01` (salón de ventas; el mostrador vende primero de acá).
- **Productos (19):**
  - con talles: zapatillas, remeras, botines y shorts;
  - sueltos: pelota, medias, mochila y botella;
  - casos especiales:
    - **Guantes de arquero:** última unidad, para probar la venta sin stock;
    - **Paleta de pádel:** sin stock, para pedidos online sin stock y la entrada de mercadería;
    - **Artículo con IVA 10,5 %:** para probar facturas con varias alícuotas.
  - Todo el stock inicial está valuado al costo, con su asiento contable.
- **Clientes:**
  - uno por condición de IVA: Juan Pérez (Consumidor Final), Club Atlético Simulado (Responsable Inscripto), Laura Gómez (Monotributista) y Fundación Deporte Simulado (Exento);
  - **Gimnasio Sin Condición**, para cargarle la condición en el momento de vender;
  - **Escuela de Fútbol**, de cuenta corriente con límite de crédito.
- **Proveedores:** Distribuidora Deportiva Sim SA y Textil Sim SRL.
- **Compras:** una **orden de compra ya enviada** a la Distribuidora (pelotas, medias y paletas de pádel), lista para recibir.
- **Movimientos iniciales**, para que la simulación arranque con vida (se omiten con `-SinMovimientos`):
  - **Caja Principal abierta** por el cajero, con $ 50.000 de fondo;
  - **5 ventas de mostrador:**
    - Juan Pérez, factura B en efectivo;
    - Club Atlético, factura A con débito;
    - Laura Gómez, factura B por transferencia;
    - Escuela de Fútbol, factura A a cuenta corriente;
    - una venta sin cliente ni factura;
  - **un pedido con envío** a Escuela de Fútbol, pendiente de picking;
  - **un pedido de Juan Pérez** ya preparado, que aparece en *Retiro Mostrador (1)* del POS.

## 4. Procesos a simular

Cada punto dice qué hacer y qué tiene que pasar. Conviene hacerlos en este orden, porque unos alimentan a otros.

### 4.1 Compras y recepción (usuario Depósito y Administrador)
1. **Recepción parcial con control de calidad:** en *Recepciones*, recibí la orden enviada. Cargá 10 pelotas (2 con falla), 20 medias y no recibas las paletas. Hacé el control de calidad y aprobá.
   - El stock aprobado entra a `DEP-A1` y lo fallado va a *Cuarentena*.
   - La orden pasa a **parcial** y ya no se puede anular.
2. **Segunda recepción:** recibí las 3 paletas en otra recepción. La orden pasa a **recibida**.
3. **Factura del proveedor con los dos remitos:** cargá la factura A. El saldo del proveedor sube por el total.
4. **Pago al proveedor:** pagá una parte en efectivo desde la caja abierta (punto 4.3) o por transferencia. El saldo baja.
5. **Devolución al proveedor de las 2 pelotas falladas:** salen de *Cuarentena* y el saldo del proveedor baja por el neto más IVA.

### 4.2 Depósito (usuario Depósito)
1. **Transferencia** de `DEP-A1` a `SAL-01`. Una transferencia desde una ubicación sin stock tiene que rechazarse.
2. **Conteo cíclico ciego** del salón: contá una unidad menos de un producto, completá y ajustá. El stock baja y queda el movimiento de ajuste.

### 4.3 Caja y mostrador (usuario Cajero)
1. **El turno de *Caja Principal* ya está abierto** con $ 50.000 y las 5 ventas iniciales. Con `-SinMovimientos` lo abrís vos desde *Gestión de caja*.
2. **Venta a Consumidor Final** (Juan Pérez) con factura B, pagando en efectivo y con tarjeta. La caja suma solo el efectivo.
3. **Venta a Club Atlético Simulado:** la letra cambia sola a **A**.
4. **Venta a Gimnasio Sin Condición:** en el cobro aparece el aviso *"no tiene cargada la condición frente al IVA"*.
   - Usá **Cargar ahora**: elegí la condición, completá el CUIT y guardá.
   - La letra se ajusta sola.
5. **Factura A sin CUIT:** elegí factura A con Juan Pérez. El cobro no deja confirmar y ofrece **Emitir factura B**.
6. **Venta de la última unidad** de los guantes, y después otra: la segunda se rechaza por falta de stock.
7. **Venta a cuenta corriente** a Escuela de Fútbol. La deuda queda en su cuenta corriente.
8. **Venta sin conexión:**
   1. En el navegador, abrí las herramientas de desarrollador (F12), pestaña *Network*, y elegí *Offline*.
   2. Vendé; la venta queda en la cola.
   3. Volvé a *Online* y verificá que se sincronice una sola vez.
9. **Cerrá el turno** con una diferencia chica. Queda registrada la diferencia.

### 4.4 Pedidos (Cajero y Depósito)
1. **Pedido con envío a cuenta corriente:**
   - pasos: crear → *picking* (Depósito) → preparado → despachado → entregado → facturar;
   - el stock se reserva al crear el pedido y se descuenta al preparar;
   - el pedido sale primero del depósito.
2. **Pedido para retirar en el local:** cobralo desde el POS con el botón *Retiro Mostrador*.
3. **Cambio del envío** (bonificarlo): el cajero no puede hacerlo; el gerente sí.

### 4.5 Cobranzas y cuentas corrientes (Cajero)
1. **Cobro parcial** de la factura de Escuela de Fútbol, una vez en efectivo y otra con **cheque**. El saldo baja y el cheque queda en cartera.
2. Revisá el **estado de cuenta** del cliente en *Cuentas Corrientes*.

### 4.6 Devoluciones y garantías (Cajero)
1. **Devolución parcial** de una venta con factura: se genera la nota de crédito, el stock vuelve y el saldo del cliente se ajusta al centavo.
2. **Garantía:** recibí un producto defectuoso, seguilo en sus estados y resolvela.

### 4.7 Facturación y ARCA (Administrador)
Sin credenciales de ARCA las facturas quedan **sin CAE**. Es lo esperado en la simulación.
1. **Volver a emitir una factura sin CAE:**
   1. En *Facturación*, abrí una factura B de Juan Pérez y usá **Anular y volver a emitir** como factura A a Club Atlético Simulado.
   2. La factura nueva muestra *"Reemplaza a la factura …"*.
   3. En *Reclamos y garantías → Notas de crédito* aparece la **nota de crédito interna `NCI-…`**, marcada *"Interna (no fiscal)"*, con el motivo y sin botón para autorizar.
   4. Los cobros y el saldo pasan al cliente nuevo.
2. **Plazo de 5 días:** como cajero, una factura con más de 5 días no se puede volver a emitir; como administrador, sí.
3. **Alertas de ARCA:** el panel de *Inicio* y el contador de *Facturación* muestran los comprobantes que necesitan atención. Sin credenciales no aparecen las de "sin autorizar a las 24 h", porque cuentan desde que se configura ARCA.
4. **Con credenciales de homologación (opcional):**
   1. Cargá el certificado y la clave en *Configuración*.
   2. Autorizá una factura A, una B y una nota de crédito vinculada a factura. Tienen que obtener CAE.
   3. Si se corta la conexión, la factura queda *"En verificación con ARCA"* y se resuelve sola.

### 4.8 Tesorería y banco (Administrador y Gerente)
1. En *Gestión de caja*, cargá el **saldo inicial de Caja 2** (solo el administrador).
2. Hacé un **traspaso** de la caja del mostrador a Caja 2 y un **débito bancario**.
3. Pagá a un proveedor desde Caja 2.

### 4.9 Contabilidad (Administrador)
1. Revisá el **libro diario**:
   - cada venta, cobro, compra, pago, devolución y ajuste tiene su asiento;
   - la reemisión deja contra-asientos que nombran la nota interna.
2. Revisá el **balance**:
   - debe y haber coinciden;
   - el saldo de *Deudores por ventas* coincide con la suma de las cuentas corrientes;
   - *Proveedores* coincide con los saldos de los proveedores.

### 4.10 Permisos (cada rol)
Entrá con cada usuario y verificá que el menú muestre solo lo suyo:
- el **depósito** no ve *Facturación*;
- el **cajero** no ve *Excepciones POS* ni *Configuración*;
- el **gerente** no ve *Configuración*.

### 4.11 Tiendanube
No está conectada en la simulación: la sincronización de stock y la importación de pedidos online se prueban aparte, con una tienda de prueba.

## 5. Verificación automática (opcional)

La simulación automática recorre 153 controles: stock por ubicación, kardex, caja, cuentas corrientes y mayor contra submayores. Corre contra esta base y deja sus propios datos de prueba (con el sufijo de la corrida):

```powershell
$env:SIM_DB_NAME = 'wsm_simulacion'; $env:SIM_ADMIN_PASSWORD = 'Simulacion2026!'
node packages/server/scripts/simulation/simulacion-operativa.mjs
```

Después conviene volver a empezar con `scripts\simulacion.ps1 -Reiniciar`.
