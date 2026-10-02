import { existsSync } from 'fs';
import type PDFDocument from 'pdfkit';

const ARIAL = 'C:\\Windows\\Fonts\\arial.ttf';
const ARIAL_BD = 'C:\\Windows\\Fonts\\arialbd.ttf';

/**
 * Fonte TTF real com ToUnicode correto (acentos extraem/renderizam certo).
 * A Helvetica padrão do pdfkit grava UTF-8 cru declarando WinAnsi (mojibake).
 * Com fallback para Helvetica quando Arial não existe.
 */
export function setupPdfFonts(doc: typeof PDFDocument): { regular: string; bold: string } {
  if (existsSync(ARIAL) && existsSync(ARIAL_BD)) {
    doc.registerFont('DocText', ARIAL);
    doc.registerFont('DocText-Bold', ARIAL_BD);
    return { regular: 'DocText', bold: 'DocText-Bold' };
  }
  return { regular: 'Helvetica', bold: 'Helvetica-Bold' };
}
