import PDFDocument from 'pdfkit';
import { setupPdfFonts } from './pdf-fonts';

export interface ReportPdfData {
  title: string;
  generatedAt: string;
  filters: Record<string, unknown>;
  columns: string[];
  rows: (string | number | null | undefined)[][];
}

const C = {
  primary: '#087F8C',
  ink: '#1A1A1A',
  gray: '#6B7280',
  grayLight: '#E5E7EB',
  zebra: '#F6F4EE',
};

function sanitize(s: string): string {
  // Com fonte TTF o Unicode vai fiel; só barra o fora do BMP.
  return s.replace(/[^\x20-\uFFFF]/g, '?');
}

function fmtCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '-';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    return new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return `${d}/${m}/${y}`;
  }
  return sanitize(s);
}

export function generateReportPDF(data: ReportPdfData): typeof PDFDocument {
  // Paisagem comporta melhor tabelas com 3+ colunas.
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40, bufferPages: true });
  const F = setupPdfFonts(doc);
  const pageW = 841.89;
  const contentW = pageW - 80;
  const bottom = 555.28 - 40;

  const filterText = sanitize(Object.entries(data.filters)
    .map(([k, v]) => `${k}: ${v}`)
    .join('  ·  '));
  const title = sanitize(data.title);

  const footer = () => {
    // doc.save/restore não preserva doc.y — salva manual.
    // Só Gerado em + filtros aqui; a numeração sai no loop final (1 passada).
    const _y = doc.y;
    const _x = doc.x;
    doc.save().fontSize(7).font(F.regular).fillColor(C.gray);
    doc.text(`Gerado em ${fmtCell(data.generatedAt)}`, 40, bottom + 8, { width: contentW });
    if (filterText) doc.text(`Filtros - ${filterText}`, 40, bottom + 18, { width: contentW });
    doc.restore();
    doc.y = _y;
    doc.x = _x;
  };

  const header = () => {
    doc.fontSize(16).font(F.bold).fillColor(C.ink).text(title, 40, 40, { width: contentW });
    doc.save().moveTo(40, 62).lineTo(40 + contentW, 62).lineWidth(0.8).strokeColor(C.primary).stroke().restore();
    doc.y = 70;
  };

  const n = Math.max(data.columns.length, 1);
  const colW = contentW / n;

  const drawHead = () => {
    const y = doc.y;
    doc.save().fillColor(C.ink).roundedRect(40, y, contentW, 18).fill();
    doc.fontSize(7.5).font(F.bold).fillColor('#FFFFFF');
    data.columns.forEach((c, i) => {
      doc.text(c, 44 + i * colW, y + 5, { width: colW - 8 });
    });
    doc.restore();
    doc.y = y + 22;
  };

  header();
  drawHead();
  footer();

  data.rows.forEach((row, ri) => {
    const cells = data.columns.map((_, i) => fmtCell(row[i] ?? null));
    doc.fontSize(7.5).font(F.regular);
    const heights = cells.map((t, _i) => doc.heightOfString(t, { width: colW - 8 }));
    const h = Math.max(16, ...heights) + 6;
    if (doc.y + h > bottom) {
      doc.addPage();
      header();
      drawHead();
      footer();
    }
    const y = doc.y;
    if (ri % 2 === 1) {
      doc.save().fillColor(C.zebra).roundedRect(40, y, contentW, h).fill().restore();
    }
    doc.fillColor(C.ink);
    cells.forEach((t, i) => {
      doc.text(t, 44 + i * colW, y + 3, { width: colW - 8 });
    });
    doc.y = y + h + 2;
  });

  if (data.rows.length === 0) {
    doc.fontSize(9).font(F.regular).fillColor(C.gray)
      .text('Sem dados para os filtros selecionados.', 40, doc.y + 6, { width: contentW });
  }

  // Numeração total correta (bufferPages permite revisitar).
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.save().fontSize(7).font(F.regular).fillColor(C.gray);
    doc.text(`Página ${i + 1} de ${range.count}`, 40, bottom + 8, { width: contentW, align: 'right' });
    doc.restore();
  }

  return doc;
}
