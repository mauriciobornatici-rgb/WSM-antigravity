import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function generatePDF() {
  console.log('Iniciando generación de PDF desde la plantilla HTML...');
  
  const htmlPath = path.join(__dirname, '..', 'docs', 'manual_master.html');
  const pdfPath = path.join(__dirname, '..', 'docs', 'manual_de_usuario.pdf');
  const artifactPdfPath = 'C:\\Users\\mauri\\.gemini\\antigravity\\brain\\104a141c-182f-48e3-abd3-2cd4b75344c6\\manual_de_usuario.pdf';

  if (!fs.existsSync(htmlPath)) {
    console.error(`Error: No se encontró el archivo HTML en ${htmlPath}`);
    process.exit(1);
  }

  const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    
    // Cargar contenido HTML
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    // Imprimir a PDF en formato A4 con fondos habilitados
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true, // Esto hace que respete el @page de CSS para los márgenes del contenido y de la portada
      margin: {
        top: '0px',
        bottom: '0px',
        left: '0px',
        right: '0px'
      }
    });

    await browser.close();
    console.log(`¡Éxito! PDF generado en el espacio de trabajo: ${pdfPath}`);

    // Copiar el archivo PDF generado al directorio de artefactos para que sea accesible en la interfaz
    fs.copyFileSync(pdfPath, artifactPdfPath);
    console.log(`¡Éxito! PDF copiado a la carpeta de artefactos de la conversación: ${artifactPdfPath}`);
  } catch (error) {
    console.error('Error al generar el PDF:', error);
    process.exit(1);
  }
}

generatePDF();
