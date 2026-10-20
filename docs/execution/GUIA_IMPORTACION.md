# Guía: cargar productos, clientes y proveedores desde Excel

Sirve para la carga inicial y para actualizaciones masivas, por ejemplo una lista de precios nueva.

## Dónde está

| Qué | Dónde | Quién puede |
|---|---|---|
| Productos | *Inventario* → **Importar** | Administrador, gerente y depósito |
| Clientes | *Clientes* → **Importar** | Administrador, gerente y cajero |
| Proveedores | *Proveedores* → **Importar** | Administrador y gerente |

## Paso a paso

1. **Descargá la plantilla** desde el botón *Descargar plantilla*. Trae:
   - las columnas, con las obligatorias en amarillo y marcadas con `*`;
   - una fila de ejemplo;
   - una hoja *Instrucciones* que explica cada columna.
2. **Completala.** También sirve tu propia planilla si los encabezados se llaman igual. Se aceptan nombres parecidos: "Código", "Precio", "CUIT", "Rubro", con o sin acentos.
3. **Elegí el archivo**, en Excel (.xlsx) o CSV. **Todavía no se guarda nada**: la aplicación muestra qué va a pasar con cada fila:
   - **nuevos**: se van a crear;
   - **ya existen**: se saltean, salvo que marques *Actualizar los que ya existen*;
   - **con errores**: no se importan, y la tabla dice qué corregir en cada fila. *Descargar listado* las baja a un archivo.
4. **Importar.** Se guarda en tandas con una barra de avance. Si algo corta a la mitad, lo guardado queda guardado. Volver a importar el mismo archivo no duplica nada, porque lo ya cargado se saltea.

## Reglas importantes

- **Precios:** el precio de venta se escribe **con IVA**, como lo ve el cliente. La aplicación guarda el neto, igual que en la pantalla de productos. El costo va **sin IVA**.
- **Números:** se aceptan `12.100`, `12100`, `12.100,50`, `$ 12.100` y celdas con formato de número de Excel.
- **Stock inicial:**
  - solo para productos **nuevos**, y necesita el costo;
  - se registra con su movimiento y un asiento contable (Mercadería contra Ajuste por inventario inicial);
  - el stock de un producto que ya existe **no cambia** con la importación: se corrige con un conteo.
- **Talles y colores:** cada talle o color es un producto con su propio SKU. Con la misma *Familia*, marca y categoría quedan agrupados como un mismo artículo.
- **Categorías, marcas, talles y colores** que no existen se crean solos. La subcategoría necesita su categoría.
- **Ubicación:** tiene que ser una ubicación cargada (por ejemplo `DEP-A1`). Vacía, el stock va a *General*.
- **Clientes y proveedores:**
  - se reconocen por CUIT, con o sin guiones;
  - **sin CUIT, se reconocen por el nombre exacto** (sin importar acentos ni mayúsculas). Así volver a importar el archivo nunca los duplica;
  - por eso dos filas con el mismo nombre y sin CUIT no se pueden importar juntas: cargale el CUIT o el DNI a cada una;
  - un Responsable Inscripto necesita el CUIT de 11 dígitos.
- **Revisá los importes:** en la vista previa de productos, la tabla *Así se leyeron los primeros productos* muestra precio, costo y stock como los entendió la aplicación. Un punto de más o de menos (`1.250` contra `1,250`) se ve ahí antes de guardar.
- **Costo de un producto que ya tiene stock:** si la importación (o la edición a mano) cambia el costo, el stock que ya estaba se revalúa con un asiento contra *Resultado por tenencia de mercaderías*: ganancia si el costo sube, pérdida si baja. La vista previa muestra el importe antes de guardar.
- **Ubicaciones que no venden** (Cuarentena, Mermas, Devoluciones a Proveedores) no reciben stock inicial.
- **Actualizar los que ya existen:** solo cambian las celdas con valor. Una celda vacía no borra nada.
- **Códigos que empiezan con 0:** en la plantilla la columna ya es de texto. En una planilla propia, escribilos con un apóstrofo adelante (`'0123...`) para que Excel no borre el cero.

## Límites

- Hasta **5.000 filas por archivo**: un catálogo más grande va en varios archivos.
- Cada tanda guarda 50 filas, así cada pedido es corto incluso en un servidor con límite de tiempo. Si otra operación está usando los mismos datos, la tanda se reintenta sola.
- **En producción:** el servidor limita las peticiones por IP (500 cada 15 minutos por defecto). Un archivo de 5.000 filas usa unas 100, y todas las computadoras del local salen con la misma IP. Si se importan catálogos grandes, conviene subir `API_RATE_LIMIT_MAX` en la configuración del servidor.
