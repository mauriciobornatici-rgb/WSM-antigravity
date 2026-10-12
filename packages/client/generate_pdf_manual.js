const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const WORKSPACE_PDF = 'c:\\Dev\\ERP\\WSM Tienda Deportes\\manual_usuario_wsm_sportserp.pdf';
const ARTIFACT_PDF = 'C:\\Users\\mauri\\.gemini\\antigravity\\brain\\00293141-64a7-44dc-aa92-904f76fd71e2\\manual_usuario_wsm_sportserp.pdf';
const HTML_FILE = 'c:\\Dev\\ERP\\WSM Tienda Deportes\\manual_usuario.html';

async function generatePDF() {
    console.log('Generando documento PDF desde HTML...');
    const browser = await puppeteer.launch({
        executablePath: CHROME_PATH,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.goto(`file:///${HTML_FILE.replace(/\\/g, '/')}`, { waitUntil: 'networkidle0' });

    await page.pdf({
        path: WORKSPACE_PDF,
        format: 'A4',
        printBackground: true,
        margin: {
            top: '20mm',
            bottom: '20mm',
            left: '15mm',
            right: '15mm'
        },
        displayHeaderFooter: true,
        headerTemplate: `<div style="font-size: 8px; font-family: sans-serif; color: #64748b; width: 100%; text-align: right; padding-right: 15mm;">WSM SportsERP — Manual Oficial de Usuario</div>`,
        footerTemplate: `<div style="font-size: 8px; font-family: sans-serif; color: #64748b; width: 100%; text-align: center;">Página <span class="pageNumber"></span> de <span class="totalPages"></span></div>`
    });

    fs.copyFileSync(WORKSPACE_PDF, ARTIFACT_PDF);
    console.log(`✅ PDF generado exitosamente en:\n - ${WORKSPACE_PDF}\n - ${ARTIFACT_PDF}`);

    await browser.close();
}

generatePDF().catch(err => {
    console.error('Error generando PDF:', err);
    process.exit(1);
});
