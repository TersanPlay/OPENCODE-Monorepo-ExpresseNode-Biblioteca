import { Pdf, hex, sanitizeWinAnsi } from './pdf';

export interface ReportPdfData {
  title: string;
  generatedAt: string;
  filters: Record<string, unknown>;
  columns: string[];
  rows: (string | number | null | undefined)[][];
}

const C = {
  primary: hex('#087F8C'),
  ink: hex('#1A1A1A'),
  gray: hex('#6B7280'),
  grayLight: hex('#E5E7EB'),
  zebra: hex('#F6F4EE'),
  white: hex('#FFFFFF'),
};

function sanitize(s: string): string {
  return sanitizeWinAnsi(s);
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

export async function generateReportPDF(data: ReportPdfData): Promise<Uint8Array> {
  // Paisagem comporta melhor tabelas com 3+ colunas.
  const pageW = 841.89;
  const pageH = 595.28;
  const contentW = pageW - 80;
  const bottom = 555.28 - 40;

  const filterText = sanitize(
    Object.entries(data.filters)
      .map(([k, v]) => `${k}: ${v}`)
      .join('  ·  '),
  );
  const title = sanitize(data.title);

  const pdf = await Pdf.create();

  const drawFooter = (pageBottom: number) => {
    // Só Gerado em + filtros aqui; a numeração sai no fim (total conhecido).
    pdf.text(`Gerado em ${fmtCell(data.generatedAt)}`, 40, pageBottom + 8, { size: 7, color: C.gray, width: contentW });
    if (filterText) pdf.text(`Filtros - ${filterText}`, 40, pageBottom + 18, { size: 7, color: C.gray, width: contentW });
  };

  const drawHeader = () => {
    pdf.text(title, 40, 40, { size: 16, font: 'bold', color: C.ink, width: contentW });
    pdf.line(40, 62, 40 + contentW, 62, C.primary, 0.8);
    pdf.y = 70;
  };

  const n = Math.max(data.columns.length, 1);
  const colW = contentW / n;

  const drawHead = () => {
    const y = pdf.y;
    pdf.roundedRect(40, y, contentW, 18, 2, { fill: C.ink });
    data.columns.forEach((col, i) => {
      pdf.text(sanitize(col), 44 + i * colW, y + 5, { size: 7.5, font: 'bold', color: C.white, width: colW - 8 });
    });
    pdf.y = y + 22;
  };

  const newPage = () => {
    pdf.addPage(pageW, pageH);
    drawHeader();
    drawHead();
    drawFooter(bottom);
  };

  newPage();

  data.rows.forEach((row, ri) => {
    const cells = data.columns.map((_, i) => fmtCell(row[i] ?? null));
    const heights = cells.map((t) => pdf.heightOf(t, 7.5, 'regular', colW - 8));
    const h = Math.max(16, ...heights) + 6;
    if (pdf.y + h > bottom) {
      newPage();
    }
    const y = pdf.y;
    if (ri % 2 === 1) {
      pdf.roundedRect(40, y, contentW, h, 2, { fill: C.zebra });
    }
    cells.forEach((t, i) => {
      pdf.text(t, 44 + i * colW, y + 3, { size: 7.5, color: C.ink, width: colW - 8 });
    });
    pdf.y = y + h + 2;
  });

  if (data.rows.length === 0) {
    pdf.text('Sem dados para os filtros selecionados.', 40, pdf.y + 6, { size: 9, color: C.gray, width: contentW });
  }

  // Numeração total (páginas conhecidas só no fim).
  const pages = pdf.doc.getPages();
  pages.forEach((_p, i) => {
    const save = { page: pdf.page, W: pdf.W, H: pdf.H };
    pdf.page = pages[i];
    pdf.W = pageW;
    pdf.H = pageH;
    pdf.text(`Página ${i + 1} de ${pages.length}`, 40, bottom + 8, { size: 7, color: C.gray, width: contentW, align: 'right' });
    pdf.page = save.page;
    pdf.W = save.W;
    pdf.H = save.H;
  });

  return pdf.save();
}
