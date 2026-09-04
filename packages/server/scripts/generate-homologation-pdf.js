import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function generatePdf() {
    const outputPath = path.resolve(__dirname, '../../../docs/execution/GUIA_HOMOLOGACION_ARCA_Y_TIENDANUBE.pdf');
    
    const htmlContent = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <title>Guía Integral de Homologación Externa — WSM SportsERP</title>
        <style>
            @page {
                size: A4;
                margin: 20mm 15mm 20mm 15mm;
                @bottom-right {
                    content: counter(page);
                }
            }
            body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                color: #1e293b;
                line-height: 1.5;
                font-size: 11pt;
            }
            .header-box {
                border-bottom: 3px solid #2563eb;
                padding-bottom: 12px;
                margin-bottom: 24px;
            }
            .header-box h1 {
                font-size: 22pt;
                color: #0f172a;
                margin: 0 0 6px 0;
            }
            .header-box h2 {
                font-size: 13pt;
                color: #475569;
                font-weight: normal;
                margin: 0 0 10px 0;
            }
            .meta-tag {
                display: inline-block;
                background: #f1f5f9;
                color: #334155;
                font-size: 9pt;
                padding: 3px 8px;
                border-radius: 4px;
                font-weight: 600;
                margin-right: 6px;
            }
            h2.section-title {
                color: #1e40af;
                font-size: 14pt;
                border-bottom: 1px solid #cbd5e1;
                padding-bottom: 4px;
                margin-top: 24px;
                margin-bottom: 12px;
            }
            h3 {
                color: #0f172a;
                font-size: 11pt;
                margin-top: 14px;
                margin-bottom: 6px;
            }
            p, ul, ol {
                margin-top: 4px;
                margin-bottom: 8px;
            }
            li {
                margin-bottom: 4px;
            }
            code {
                font-family: Consolas, "Courier New", Courier, monospace;
                background: #f1f5f9;
                color: #b91c1c;
                padding: 1px 4px;
                border-radius: 3px;
                font-size: 9.5pt;
            }
            pre {
                background: #0f172a;
                color: #f8fafc;
                padding: 10px;
                border-radius: 6px;
                font-size: 9pt;
                overflow-x: auto;
                margin: 8px 0;
            }
            pre code {
                background: transparent;
                color: inherit;
                padding: 0;
            }
            .alert {
                background: #eff6ff;
                border-left: 4px solid #3b82f6;
                padding: 10px 14px;
                border-radius: 4px;
                margin: 12px 0;
                font-size: 10pt;
            }
            .alert-warning {
                background: #fffbeb;
                border-left-color: #f59e0b;
                color: #92400e;
            }
            table {
                width: 100%;
                border-collapse: collapse;
                margin: 14px 0;
                font-size: 9.5pt;
            }
            th, td {
                border: 1px solid #cbd5e1;
                padding: 8px 10px;
                text-align: left;
            }
            th {
                background: #f8fafc;
                color: #1e293b;
                font-weight: 600;
            }
            tr:nth-child(even) {
                background: #f8fafc;
            }
            .page-break {
                page-break-before: always;
            }
            .footer-note {
                margin-top: 30px;
                border-top: 1px solid #e2e8f0;
                padding-top: 8px;
                font-size: 8.5pt;
                color: #64748b;
                text-align: center;
            }
        </style>
    </head>
    <body>
        <div class="header-box">
            <h1>WSM SportsERP</h1>
            <h2>Guía Integral de Homologación Externa: ARCA (AFIP) y Tiendanube</h2>
            <div>
                <span class="meta-tag">VERSIÓN 1.0</span>
                <span class="meta-tag">ENTORNO: TESTING / SANDBOX</span>
                <span class="meta-tag">FECHA: SEPTIEMBRE 2026</span>
                <span class="meta-tag">SEGURIDAD: AES-256-GCM</span>
            </div>
        </div>

        <div class="alert alert-warning">
            <strong>Importante:</strong> Esta guía describe los procedimientos técnicos para realizar pruebas en entornos de homologación. Todos los pasos deben completarse utilizando certificados y claves de prueba, sin ningún impacto fiscal, monetario ni tributario real.
        </div>

        <h2 class="section-title">1. Homologación ARCA (AFIP - Facturación Electrónica)</h2>

        <h3>1.1 Requisitos Previos</h3>
        <ul>
            <li>CUIT habilitado en AFIP con Clave Fiscal nivel 3.</li>
            <li>Computadora con OpenSSL instalado (para generar la clave y el CSR).</li>
            <li>Acceso a WSM SportsERP en el panel <code>/settings</code> con rol de Administrador.</li>
        </ul>

        <h3>1.2 Generación de Certificado de Prueba (OpenSSL)</h3>
        <p>Ejecutar los siguientes comandos en la terminal:</p>
        <pre><code># 1. Generar la clave privada RSA de 2048 bits
openssl genrsa -out afip_testing.key 2048

# 2. Generar el Certificate Signing Request (CSR)
openssl req -new -key afip_testing.key -subj "/C=AR/O=WSM_DEPORTES/CN=WSM_HOMOLOGACION/serialNumber=CUIT 20XXXXXXXX9" -out afip_testing.csr</code></pre>
        <p><em>(Reemplazar <code>20XXXXXXXX9</code> por el CUIT que realizará el ensayo).</em></p>

        <h3>1.3 Autorización en el Portal de AFIP (Homologación)</h3>
        <ol>
            <li>Ingresar al portal de AFIP (<a href="https://auth.afip.gob.ar">https://auth.afip.gob.ar</a>).</li>
            <li>Habilitar el servicio <strong>"WSASS - Autogestión Certificados Homologación"</strong> desde el Administrador de Relaciones.</li>
            <li>En <strong>WSASS</strong>, seleccionar <em>"Crear Certificado"</em> y pegar el contenido de <code>afip_testing.csr</code>. Descargar el archivo <code>.crt</code> generado.</li>
            <li>En <strong>"Autorización a Servicios"</strong>, seleccionar el certificado creado y vincular el servicio <strong>wsfe (Facturación Electrónica)</strong>.</li>
            <li>En <strong>"Administración de Puntos de Venta y Domicilios"</strong>, dar de alta un Punto de Venta electrónico (ej. <code>2</code>) con modalidad <em>"RECE para aplicativo y/o web service"</em>.</li>
        </ol>

        <h3>1.4 Carga en WSM SportsERP</h3>
        <p>En WSM SportsERP, navegar a <strong>Configuración (/settings) &gt; Facturación Electrónica &amp; ARCA</strong>:</p>
        <ul>
            <li><strong>Ambiente:</strong> Homologación / Testing.</li>
            <li><strong>CUIT Emisor:</strong> CUIT del contribuyente de prueba.</li>
            <li><strong>Punto de Venta:</strong> Número configurado en AFIP (ej. <code>2</code>).</li>
            <li><strong>Certificado Digital:</strong> Contenido completo del archivo <code>afip_testing.crt</code>.</li>
            <li><strong>Clave Privada:</strong> Contenido completo del archivo <code>afip_testing.key</code>.</li>
        </ul>
        <p>Al presionar <strong>Guardar</strong>, WSM cifra ambos secretos en reposo con <strong>AES-256-GCM</strong>.</p>

        <div class="page-break"></div>

        <h3>1.5 Protocolo de Ensayo Controlado ARCA</h3>
        <table>
            <thead>
                <tr>
                    <th style="width: 8%;">Paso</th>
                    <th style="width: 42%;">Acción Realizada</th>
                    <th style="width: 50%;">Resultado Esperado en WSM SportsERP</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td><strong>1</strong></td>
                    <td>En <strong>Configuración</strong>, pulsar <em>"Probar Conexión AFIP"</em>.</td>
                    <td>Respuesta exitosa (HTTP 200). WSAA entrega Token &amp; Sign válidos por 12 horas.</td>
                </tr>
                <tr>
                    <td><strong>2</strong></td>
                    <td>En <strong>POS</strong>, crear una venta de $1.000 a Consumidor Final.</td>
                    <td>La venta se registra localmente de inmediato con estado <code>issued</code>.</td>
                </tr>
                <tr>
                    <td><strong>3</strong></td>
                    <td>Marcar <em>"Emitir comprobante fiscal"</em> (Factura B).</td>
                    <td>Se procesa la orden y se asocia la factura pendiente de autorización.</td>
                </tr>
                <tr>
                    <td><strong>4</strong></td>
                    <td>Pulsar <em>"Autorizar CAE"</em> en el comprobante.</td>
                    <td>WSFE sandbox otorga el <strong>CAE de 14 dígitos</strong>, vencimiento y número oficial <code>B-0002-00000001</code>.</td>
                </tr>
                <tr>
                    <td><strong>5</strong></td>
                    <td>Abrir impresión de Factura A4 o Ticket Térmico.</td>
                    <td>El comprobante renderiza el <strong>Código QR oficial de AFIP</strong> escaneable y los datos de CAE.</td>
                </tr>
                <tr>
                    <td><strong>6</strong></td>
                    <td>Verificar <strong>Finanzas &gt; Contabilidad</strong>.</td>
                    <td>Se genera el asiento contable inmutable de venta e IVA Débito Fiscal.</td>
                </tr>
            </tbody>
        </table>

        <h2 class="section-title">2. Homologación Tiendanube (Sandbox de Comercio Electrónico)</h2>

        <h3>2.1 Requisitos Previos</h3>
        <ul>
            <li>Cuenta Partner en <a href="https://partners.tiendanube.com">https://partners.tiendanube.com</a>.</li>
            <li>Tienda de prueba creada (Sandbox Store).</li>
            <li>URL HTTPS pública para webhooks (ej. ngrok o Cloudflare Tunnel para entorno de desarrollo).</li>
        </ul>

        <h3>2.2 Creación de App y Credenciales OAuth</h3>
        <ol>
            <li>En el Portal de Partners, ir a <strong>Mis Aplicaciones &gt; Crear Aplicación</strong>.</li>
            <li>Configurar URL de redirección: <code>https://&lt;dominio&gt;/api/tiendanube/oauth/callback</code>.</li>
            <li>Permisos necesarios: <code>read_products, write_products, read_orders, write_orders, read_customers, write_customers, read_shipping</code>.</li>
            <li>Copiar el <strong>Client ID</strong> y <strong>Client Secret</strong> asignados.</li>
        </ol>

        <h3>2.3 Vinculación y Registro de Webhooks</h3>
        <ol>
            <li>En WSM SportsERP, ir a <strong>Tienda online &gt; Configuración</strong>.</li>
            <li>Ingresar Client ID y Client Secret, y pulsar <strong>"Conectar con Tiendanube"</strong>.</li>
            <li>Aceptar la autorización en Tiendanube. El sistema almacena los tokens cifrados.</li>
            <li>En la misma pantalla, presionar <strong>"Sincronizar Webhooks"</strong> para registrar los eventos de órdenes y catálogo.</li>
        </ol>

        <h3>2.4 Protocolo de Ensayo Controlado Tiendanube</h3>
        <table>
            <thead>
                <tr>
                    <th style="width: 8%;">Paso</th>
                    <th style="width: 42%;">Acción Realizada</th>
                    <th style="width: 50%;">Resultado Esperado</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td><strong>1</strong></td>
                    <td>Crear producto con SKU <code>TEST-TN-001</code> y stock 10 en WSM.</td>
                    <td>Producto dado de alta en inventario WMS con trazabilidad inicial.</td>
                </tr>
                <tr>
                    <td><strong>2</strong></td>
                    <td>En <strong>Tienda online &gt; Catálogo</strong>, pulsar <em>"Publicar"</em>.</td>
                    <td>El producto aparece en Tiendanube con foto, precio y 10 unidades.</td>
                </tr>
                <tr>
                    <td><strong>3</strong></td>
                    <td>Comprar 2 unidades desde la tienda pública de prueba.</td>
                    <td>Se genera la orden #1001 en Tiendanube.</td>
                </tr>
                <tr>
                    <td><strong>4</strong></td>
                    <td>Verificar <strong>Tienda online &gt; Pedidos</strong> en WSM.</td>
                    <td>Ingresa el webhook y crea el pedido en WSM, reservando 2 unidades.</td>
                </tr>
                <tr>
                    <td><strong>5</strong></td>
                    <td>Procesar el picking y empaque en WSM.</td>
                    <td>El stock físico baja a 8 unidades y se sincroniza automáticamente a Tiendanube.</td>
                </tr>
                <tr>
                    <td><strong>6</strong></td>
                    <td>Simular reenvío de webhook duplicado.</td>
                    <td>La capa de idempotencia de WSM lo descarta sin duplicar órdenes ni movimientos.</td>
                </tr>
            </tbody>
        </table>

        <div class="footer-note">
            WSM SportsERP — Manual Oficial de Homologación y Ensayos de Staging — Documento Confidencial
        </div>
    </body>
    </html>
    `;

    console.log('Lanzando Puppeteer...');
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    
    console.log('Generando archivo PDF...');
    await page.pdf({
        path: outputPath,
        format: 'A4',
        printBackground: true,
        margin: {
            top: '15mm',
            right: '15mm',
            bottom: '15mm',
            left: '15mm'
        }
    });

    await browser.close();
    console.log('PDF generado exitosamente en:', outputPath);
}

generatePdf().catch(err => {
    console.error('Error generando PDF:', err);
    process.exit(1);
});
