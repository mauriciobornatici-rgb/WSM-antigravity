# Procedimiento: comprobante en conflicto con ARCA

Decisión del usuario (ADR-025): el comprobante queda trabado y lo resuelve el administrador a mano, consultando ARCA. El sistema no lo anula ni lo vuelve a pedir.

## Qué significa

ARCA autorizó un comprobante (factura o nota de crédito) con el número **N** y le dio un CAE. Pero en el sistema ya hay **otro** comprobante autorizado con ese mismo tipo, punto de venta y número N, con un CAE distinto. Para ARCA cada número tiene un solo comprobante, así que uno de los dos datos locales no coincide con lo que ARCA tiene.

El sistema guarda el CAE recibido, marca el comprobante como **"Conflicto con ARCA"** y no vuelve a pedir autorización. Así se evita un segundo CAE para la misma venta.

## Dónde aparece

- En **Inicio**, en la tarjeta de alertas de ARCA (los conflictos van primero).
- En el contador del menú **Facturación**.
- En el comprobante, con la etiqueta roja "Conflicto con ARCA" y el motivo registrado.

## Causa más común y cómo evitarla

Casi siempre pasa porque **alguien emitió un comprobante por fuera del sistema en el mismo punto de venta**, por ejemplo desde *Comprobantes en línea* de ARCA u otro programa de facturación. Entonces ARCA y el sistema numeran por separado.

**Prevención:** usá para el sistema un punto de venta exclusivo, de tipo *Web Services*, y no emitas nunca a mano en ese punto de venta.

## Qué hacer

1. **Anotá los datos de los dos comprobantes:**
   - el que está en conflicto: tipo, punto de venta, número N, CAE, importe y cliente;
   - el otro comprobante local con el mismo número, que se busca en *Facturación* (o en *Notas de crédito*) por número.
2. **Consultá ARCA** con la clave fiscal de la empresa:
   - en *Comprobantes en línea* → *Consultas*, buscá el comprobante N de ese tipo y punto de venta: CAE, fecha, importe y receptor;
   - con el servicio público de *Constatación de comprobantes* de ARCA, verificá cada uno de los dos CAE.
3. **Decidí cuál es el válido:** es el que coincide con lo que ARCA tiene registrado para el número N (CAE, importe y receptor).
4. **Pedí la corrección al soporte técnico** con lo que encontraste. Arreglar los datos del comprobante que no coincide implica tocar la numeración, y se hace con una corrección auditada, nunca editando la base a mano.
   - Si ese comprobante corresponde a otro número en ARCA (por ejemplo, porque se emitió a mano), se le asigna el número correcto.
   - Si una venta quedó sin comprobante válido, se factura con el procedimiento habitual una vez corregido.
5. Si el comprobante válido tiene datos incorrectos (importe o cliente), se corrige con una **nota de crédito fiscal** asociada a ese comprobante, como cualquier factura con CAE.

## Qué no hacer

- No emitir otra factura por la misma venta mientras el conflicto está abierto: sería facturarla dos veces.
- No borrar ni editar comprobantes desde la base de datos.
- No volver a pedir autorización a ARCA: el sistema lo impide a propósito.
