import PDFDocument from 'pdfkit';
import { setupPdfFonts } from './pdf-fonts';

// Tamanho físico exato da etiqueta: 140 mm × 50 mm (proporção 2,8:1).
export const LABEL_W_MM = 140;
export const LABEL_H_MM = 50;
const MM = 72 / 25.4;

export interface LabelBookData {
  cdd?: string | null;
  cutter?: string | null;
  isbn10?: string | null;
  isbn13?: string | null;
  publicationYear?: number | null;
}

export interface LabelData {
  book: LabelBookData;
  exemplar: number;
}

const C = {
  ink: '#111827',
  gray: '#6B7280',
  grayDark: '#374151',
  line: '#D1D5DB',
  border: '#1A1A1A',
};

function clean(v?: string | null): string {
  if (!v) return '';
  const s = String(v).replace(/[^\x20-\uFFFF]/g, '').trim();
  return s;
}

function drawLabel(
  doc: InstanceType<typeof PDFDocument>,
  W: number,
  H: number,
  F: { regular: string; bold: string },
  data: LabelData,
) {
  // Moldura da etiqueta (delimita os 140×50 mm na impressão).
  doc.rect(0.6, 0.6, W - 1.2, H - 1.2).lineWidth(1.2).stroke(C.border);

  // Bloco esquerdo: informações bibliográficas e de localização (somente valores).
  const leftX = 9;
  const dividerX = 146;
  const values: string[] = [];
  const cdd = clean(data.book.cdd);
  if (cdd) values.push(cdd);
  const cutter = clean(data.book.cutter);
  if (cutter) values.push(cutter);
  const isbn = clean(data.book.isbn13) || clean(data.book.isbn10);
  if (isbn) values.push(isbn);
  values.push(`EX. ${data.exemplar}`);
  if (data.book.publicationYear) values.push(String(data.book.publicationYear));

  let y = 13;
  const rowH = 13.5;
  for (const v of values) {
    doc.font(F.regular).fontSize(9).fillColor(C.ink).text(v, leftX, y, { width: dividerX - leftX - 6 });
    y += rowH;
  }

  // Divisor entre bloco esquerdo e bloco institucional.
  doc.moveTo(dividerX, 8).lineTo(dividerX, H - 8).lineWidth(0.7).stroke(C.line);

  // Bloco principal: identificação institucional.
  const mainX = dividerX + 12;
  const mainW = W - mainX - 12;
  doc.font(F.bold).fontSize(13.5).fillColor(C.ink)
    .text('Câmara Municipal de Parauapebas', mainX, 26, { width: mainW });
  doc.font(F.regular).fontSize(9.5).fillColor(C.grayDark)
    .text('Memorial e Biblioteca Legislativa Sônia Côrtes', mainX, 48, { width: mainW });
  doc.font(F.regular).fontSize(7.5).fillColor(C.gray)
    .text('DTI - Departamento de Tecnologia da Informação', mainX, 64, { width: mainW });

  // Base: identificação do sistema (direita).
  doc.font(F.regular).fontSize(6.8).fillColor(C.gray)
    .text('@ Copyright Legislivros', W - 9 - 150, H - 17, { width: 150, align: 'right' });
}

/**
 * Gera PDF com uma página por etiqueta, cada página medindo exatamente
 * 140 mm × 50 mm (sem redimensionamento que altere a proporção).
 */
export function generateLabelsPDF(labels: LabelData[]): Promise<Buffer> {
  const W = LABEL_W_MM * MM;
  const H = LABEL_H_MM * MM;
  const doc = new PDFDocument({ size: [W, H], margin: 0, autoFirstPage: false });
  const F = setupPdfFonts(doc);

  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  for (const label of labels) {
    doc.addPage();
    drawLabel(doc, W, H, F, label);
  }
  doc.end();
  return done;
}
