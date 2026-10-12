import { Pdf, hex, sanitizeWinAnsi } from './pdf';

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
  ink: hex('#111827'),
  gray: hex('#6B7280'),
  grayDark: hex('#374151'),
  line: hex('#D1D5DB'),
  border: hex('#1A1A1A'),
};

function clean(v?: string | null): string {
  if (!v) return '';
  return sanitizeWinAnsi(String(v).replace(/[^\x20-\uFFFF]/g, '').trim());
}

function drawLabel(pdf: Pdf, W: number, H: number, data: LabelData) {
  // Moldura da etiqueta (delimita os 140×50 mm na impressão).
  pdf.rect(0.6, 0.6, W - 1.2, H - 1.2, C.border, 1.2);

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
    pdf.text(v, leftX, y, { size: 9, color: C.ink, width: dividerX - leftX - 6 });
    y += rowH;
  }

  // Divisor entre bloco esquerdo e bloco institucional.
  pdf.line(dividerX, 8, dividerX, H - 8, C.line, 0.7);

  // Bloco principal: identificação institucional.
  const mainX = dividerX + 12;
  const mainW = W - mainX - 12;
  pdf.text('Câmara Municipal de Parauapebas', mainX, 26, { size: 13.5, font: 'bold', color: C.ink, width: mainW });
  pdf.text('Memorial e Biblioteca Legislativa Sônia Côrtes', mainX, 48, { size: 9.5, color: C.grayDark, width: mainW });
  pdf.text('DTI - Departamento de Tecnologia da Informação', mainX, 64, { size: 7.5, color: C.gray, width: mainW });

  // Base: identificação do sistema (direita).
  pdf.text('@ Copyright Legislivros', W - 9 - 150, H - 17, { size: 6.8, color: C.gray, width: 150, align: 'right' });
}

/**
 * Gera PDF com uma página por etiqueta, cada página medindo exatamente
 * 140 mm × 50 mm (sem redimensionamento que altere a proporção).
 */
export async function generateLabelsPDF(labels: LabelData[]): Promise<Uint8Array> {
  const W = LABEL_W_MM * MM;
  const H = LABEL_H_MM * MM;
  const pdf = await Pdf.create();
  for (const label of labels) {
    pdf.addPage(W, H);
    drawLabel(pdf, W, H, label);
  }
  return pdf.save();
}
