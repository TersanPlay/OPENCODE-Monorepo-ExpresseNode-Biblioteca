import PDFDocument from 'pdfkit';
import { createHash } from 'crypto';
import { setupPdfFonts } from './pdf-fonts';

interface LoanTermData {
  id: number;
  number: string | null;
  readerId: number;
  bookId: number;
  loanDate: Date;
  dueDate: Date;
  createdAt: Date;
  readerNameSnapshot: string | null;
  bookTitleSnapshot: string | null;
  bookAuthorSnapshot: string | null;
  bookIsbnSnapshot: string | null;
  bookNumberSnapshot: string | null;
  createdByNameSnapshot: string | null;
  returnedAt: Date | null;
  returnCondition: string | null;
  returnObservations: string | null;
  receivedByNameSnapshot: string | null;
  loanSignature: string | null;
  loanSignedAt: Date | null;
  returnSignature: string | null;
  returnSignedAt: Date | null;
  createdBySignatureSnapshot: string | null;
  receivedBySignatureSnapshot: string | null;
  returnGroup: string | null;
  reader?: { name: string } | null;
  book?: { title: string; isbn10: string | null; isbn13: string | null } | null;
  user?: { name: string } | null;
}

interface LibrarySettings {
  libraryName: string;
  libraryAddress: string | null;
  libraryPhone: string | null;
  libraryEmail: string | null;
}

const C = {
  primary: '#087F8C',
  ink: '#1A1A1A',
  gray: '#6B7280',
  grayLight: '#E5E7EB',
  white: '#FFFFFF',
};

const M = { left: 50, right: 545, contentLeft: 60, contentWidth: 485 };

// Fonte vigente do documento em geração (setupPdfFonts por gerador;
// geração é síncrona, sem intercalamento entre documentos).
let FF: { regular: string; bold: string } = { regular: 'Helvetica', bold: 'Helvetica-Bold' };

function useFonts(doc: typeof PDFDocument): { regular: string; bold: string } {
  FF = setupPdfFonts(doc);
  return FF;
}

function formatDate(d: Date | string): string {
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTime(d: Date | string): string {
  return new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function verificationCode(prefix: string, id: number, date: Date): string {
  const hash = createHash('sha256').update(`${prefix}-${id}-${date.getTime()}`).digest('hex').slice(0, 6).toUpperCase();
  return `${prefix}-${date.getFullYear()}-${String(id).padStart(6, '0')}-${hash}`;
}

function drawBookIcon(doc: typeof PDFDocument, x: number, y: number, size: number) {
  const s = size, sx = s / 24, sy = s / 24;
  doc.save();
  doc.fill(C.primary).roundedRect(x, y, s, s, 3).fill();
  doc.strokeColor(C.white).lineWidth(1.4).lineCap('round').lineJoin('round').fillColor('none');
  doc.moveTo(x + 12 * sx, y + 7 * sy).lineTo(x + 12 * sx, y + 21 * sy).stroke();
  doc.moveTo(x + 2 * sx, y + 4 * sy)
    .lineTo(x + 2 * sx, y + 17 * sy).lineTo(x + 4 * sx, y + 19 * sy).lineTo(x + 9 * sx, y + 21 * sy)
    .lineTo(x + 12 * sx, y + 7 * sy)
    .lineTo(x + 15 * sx, y + 21 * sy).lineTo(x + 20 * sx, y + 19 * sy).lineTo(x + 22 * sx, y + 17 * sy)
    .lineTo(x + 22 * sx, y + 4 * sy).lineTo(x + 20 * sx, y + 3 * sy).lineTo(x + 16 * sx, y + 3 * sy)
    .lineTo(x + 12 * sx, y + 7 * sy)
    .lineTo(x + 8 * sx, y + 3 * sy).lineTo(x + 4 * sx, y + 3 * sy).closePath().stroke();
  doc.restore();
}

function drawHeader(doc: typeof PDFDocument, s: LibrarySettings): number {
  drawBookIcon(doc, 50, 32, 30);
  doc.fontSize(12).font(FF.bold).fillColor(C.ink).text(s.libraryName || 'Biblioteca Pública', 88, 35, { width: 320 });
  doc.save().fontSize(6.5).font(FF.regular).fillColor(C.gray).text('Página 1 de 1', 420, 38, { width: 125, align: 'right' }).restore();
  doc.fontSize(7).font(FF.regular).fillColor(C.gray);
  const parts: string[] = [];
  if (s.libraryAddress) parts.push(s.libraryAddress);
  if (s.libraryPhone) parts.push(`Tel: ${s.libraryPhone}`);
  if (s.libraryEmail) parts.push(s.libraryEmail);
  if (parts.length) doc.text(parts.join('  |  '), 88, doc.y + 1, { width: 420 });
  const ly = Math.max(doc.y + 5, 74);
  doc.save().moveTo(50, ly).lineTo(545, ly).lineWidth(0.8).strokeColor(C.primary).stroke().restore();
  return ly + 8;
}

function section(doc: typeof PDFDocument, y: number, title: string, h: (doc: typeof PDFDocument) => void): number {
  doc.save().fontSize(8).font(FF.bold).fillColor(C.primary).text(title.toUpperCase(), 54, y + 6).restore();
  doc.y = y + 18; doc.x = 55;
  h(doc);
  const ey = doc.y + 5;
  doc.save().lineWidth(0.4).strokeColor(C.grayLight).roundedRect(50, y, 495, ey - y, 3).stroke().restore();
  return ey + 4;
}

function field(doc: typeof PDFDocument, label: string, value: string, x: number, y: number, w: number) {
  doc.save().fontSize(6.5).font(FF.regular).fillColor(C.gray).text(label, x, y, { width: w });
  doc.fontSize(8.5).font(FF.bold).fillColor(C.ink).text(value || '—', x, doc.y + 0.5, { width: w });
  doc.restore();
}

function fieldRow(doc: typeof PDFDocument, fields: { label: string; value: string }[], y: number) {
  const n = fields.length;
  const totalW = M.contentWidth;
  const gap = 12;
  const colW = (totalW - gap * (n - 1)) / n;
  fields.forEach((f, i) => field(doc, f.label, f.value, M.contentLeft + i * (colW + gap), y, colW));
}

function drawFooter(doc: typeof PDFDocument, code: string, at: Date, num: string | null, by: string | null) {
  const fy = 755;
  doc.save().moveTo(50, fy).lineTo(545, fy).lineWidth(0.4).strokeColor(C.grayLight).stroke().restore();
  doc.save().fontSize(6.5).font(FF.regular).fillColor(C.gray);
  doc.text(`Código de verificação: ${code}`, 50, fy + 5, { width: 260 });
  doc.text('Documento gerado eletronicamente pelo Sistema de Gestão da Biblioteca.', 50, fy + 14, { width: 260 });
  doc.text(`Emitido em ${formatDateTime(at)}`, 340, fy + 5, { width: 205, align: 'right' });
  if (num) doc.text(`Empréstimo: ${num}`, 340, fy + 14, { width: 205, align: 'right' });
  if (by) doc.text(`Registrado por: ${by}`, 340, fy + 23, { width: 205, align: 'right' });
  doc.restore();
}

// Desenha a assinatura digital (PNG data-URL) na caixa (x, y, w, h).
// Retorna false quando ausente/inválida — o chamador mantém as linhas manuais.
function drawSignature(doc: typeof PDFDocument, dataUrl: string | null | undefined, x: number, y: number, w: number, h: number): boolean {
  if (!dataUrl) return false;
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!m) return false;
  try {
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length === 0 || buf.length > 700000) return false;
    doc.save();
    doc.image(buf, x, y, { fit: [w, h] });
    doc.restore();
    return true;
  } catch {
    return false;
  }
}

export function generateLoanTermPDF(loan: LoanTermData, settings: LibrarySettings): typeof PDFDocument {
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
  useFonts(doc);
  const num = loan.number || `EMP-${String(loan.id).padStart(6, '0')}`;
  const code = verificationCode('EMP', loan.id, loan.createdAt);

  const readerName = loan.readerNameSnapshot || loan.reader?.name || '—';
  const bookTitle = loan.bookTitleSnapshot || loan.book?.title || '—';
  const bookAuthor = loan.bookAuthorSnapshot || '—';
  const bookIsbn = loan.bookIsbnSnapshot || loan.book?.isbn13 || loan.book?.isbn10 || '—';
  const bookNumber = loan.bookNumberSnapshot || String(loan.bookId);
  const createdByName = loan.createdByNameSnapshot || loan.user?.name || '—';

  const hY = drawHeader(doc, settings);
  doc.y = hY; doc.x = 50;
  doc.fontSize(15).font(FF.bold).fillColor(C.ink).text('TERMO DE EMPRÉSTIMO', { align: 'center' });
  doc.fontSize(9).font(FF.regular).fillColor(C.primary).text(num, { align: 'center' });
  doc.moveDown(0.3);

  let y = doc.y + 2;

  y = section(doc, y, '1. Empréstimo', (doc) => {
    fieldRow(doc, [
      { label: 'Número:', value: num },
      { label: 'Data/Hora:', value: formatDateTime(loan.createdAt) },
      { label: 'Previsão devolução:', value: formatDate(loan.dueDate) },
    ], doc.y);
  });

  y = section(doc, y, '2. Leitor', (doc) => {
    fieldRow(doc, [
      { label: 'Nome completo:', value: readerName },
      { label: 'Código:', value: `LTR-${String(loan.readerId).padStart(6, '0')}` },
    ], doc.y);
  });

  y = section(doc, y, '3. Material Bibliográfico', (doc) => {
    fieldRow(doc, [
      { label: 'Título:', value: bookTitle },
      { label: 'Autor(es):', value: bookAuthor },
    ], doc.y);
    doc.y += 16;
    fieldRow(doc, [
      { label: 'ISBN:', value: bookIsbn },
      { label: 'Código/Tombo:', value: `#${bookNumber}` },
    ], doc.y);
  });

  y = section(doc, y, '4. Registro do Atendimento', (doc) => {
    fieldRow(doc, [
      { label: 'Servidor/Responsável:', value: createdByName },
      { label: 'Data do empréstimo:', value: formatDate(loan.loanDate) },
    ], doc.y);
    doc.y += 16;
    doc.save().fontSize(7.5).font(FF.regular).fillColor(C.gray);
    doc.text('Declaro que o material acima foi recebido pelo leitor na data indicada, comprometendo-se à devolução no prazo estabelecido.', M.contentLeft, doc.y, { width: M.contentWidth, lineGap: 1.5 });
    doc.restore();
  });

  section(doc, y, '5. Assinaturas', (doc) => {
    const sy = doc.y + 6;
    const sigH = 42;
    if (loan.loanSignature && drawSignature(doc, loan.loanSignature, 60, sy, 200, sigH)) {
      doc.save().fontSize(6.5).font(FF.regular).fillColor(C.gray);
      doc.text('Assinatura do Leitor (digital)', 60, sy + sigH + 2);
      doc.text(readerName, 60, doc.y + 8);
      if (loan.loanSignedAt) doc.text(`Assinado em ${formatDateTime(loan.loanSignedAt)}`, 60, doc.y + 8);
      doc.restore();
    } else {
      doc.save().fontSize(7.5).font(FF.regular).fillColor(C.ink);
      doc.text('________________________________', 60, sy);
      doc.fontSize(6.5).fillColor(C.gray).text('Assinatura do Leitor', 60, doc.y + 1);
      doc.text(readerName, 60, doc.y + 8);
      doc.restore();
    }
    const leftEnd = doc.y + 5;
    doc.save().fontSize(7.5).font(FF.regular).fillColor(C.ink);
    if (loan.createdBySignatureSnapshot && drawSignature(doc, loan.createdBySignatureSnapshot, 300, sy, 200, sigH)) {
      doc.fontSize(6.5).fillColor(C.gray).text('Responsável pelo atendimento (digital)', 300, sy + sigH + 2);
      doc.text(createdByName, 300, doc.y + 8);
    } else {
      doc.text('________________________________', 300, sy);
      doc.fontSize(6.5).fillColor(C.gray).text('Responsável pelo atendimento', 300, doc.y + 1);
      doc.text(createdByName, 300, doc.y + 8);
    }
    doc.restore();
    doc.y = Math.max(sy + 40, leftEnd, doc.y + 5);
  });

  drawFooter(doc, code, loan.createdAt, num, createdByName);
  return doc;
}

export function generateReturnTermPDF(loan: LoanTermData, settings: LibrarySettings): typeof PDFDocument {
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
  useFonts(doc);

  const loanNum = loan.number || `EMP-${String(loan.id).padStart(6, '0')}`;
  const retNum = `DEV-${String(loan.id).padStart(6, '0')}`;
  const code = verificationCode('DEV', loan.id, loan.returnedAt || new Date());

  const readerName = loan.readerNameSnapshot || loan.reader?.name || '—';
  const bookTitle = loan.bookTitleSnapshot || loan.book?.title || '—';
  const bookAuthor = loan.bookAuthorSnapshot || '—';
  const bookIsbn = loan.bookIsbnSnapshot || loan.book?.isbn13 || loan.book?.isbn10 || '—';
  const bookNumber = loan.bookNumberSnapshot || String(loan.bookId);
  const receivedByName = loan.receivedByNameSnapshot || '—';

  const loanDays = loan.returnedAt
    ? Math.ceil((new Date(loan.returnedAt).getTime() - new Date(loan.loanDate).getTime()) / 86400000) : 0;
  const isOverdue = loan.returnedAt && new Date(loan.returnedAt) > new Date(loan.dueDate);
  const lateDays = isOverdue
    ? Math.ceil((new Date(loan.returnedAt!).getTime() - new Date(loan.dueDate).getTime()) / 86400000) : 0;

  const statusText = isOverdue ? `DEVOLVIDO COM ATRASO (${lateDays} dia(s))` : 'DEVOLVIDO NO PRAZO';
  const statusColor = isOverdue ? '#DC2626' : '#16A34A';
  const condMap: Record<string, string> = { 'BOM': 'Bom estado', 'REGULAR': 'Regular', 'DANIFICADO': 'Danificado' };
  const condLabel = loan.returnCondition ? (condMap[loan.returnCondition] || loan.returnCondition) : 'Não informado';

  const hY = drawHeader(doc, settings);
  doc.y = hY; doc.x = 50;
  doc.fontSize(15).font(FF.bold).fillColor(C.ink).text('TERMO DE DEVOLUÇÃO', { align: 'center' });
  doc.fontSize(9).font(FF.regular).fillColor(C.primary).text(retNum, { align: 'center' });
  doc.moveDown(0.3);

  let y = doc.y + 2;

  y = section(doc, y, '1. Situação e Condição', (doc) => {
    doc.save().fontSize(9.5).font(FF.bold).fillColor(statusColor).text(statusText, M.contentLeft, doc.y, { width: M.contentWidth });
    doc.restore();
    doc.y += 10;
    fieldRow(doc, [
      { label: 'Condição do material:', value: condLabel },
    ], doc.y);
    if (loan.returnObservations) {
      doc.y += 16;
      doc.save().fontSize(6.5).font(FF.regular).fillColor(C.gray).text('OCORRÊNCIAS:', M.contentLeft, doc.y);
      doc.fontSize(8).font(FF.bold).fillColor(C.ink).text(loan.returnObservations, M.contentLeft, doc.y + 1.5, { width: M.contentWidth, lineGap: 1 });
      doc.restore();
    }
  });

  y = section(doc, y, '2. Empréstimo', (doc) => {
    fieldRow(doc, [
      { label: 'Empréstimo:', value: loanNum },
      { label: 'Devolução:', value: retNum },
      { label: 'Dias de empréstimo:', value: `${loanDays} dia(s)` },
    ], doc.y);
    doc.y += 16;
    fieldRow(doc, [
      { label: 'Data do empréstimo:', value: formatDate(loan.loanDate) },
      { label: 'Previsão devolução:', value: formatDate(loan.dueDate) },
      { label: 'Devolução efetiva:', value: loan.returnedAt ? formatDateTime(loan.returnedAt) : '—' },
    ], doc.y);
  });

  y = section(doc, y, '3. Leitor', (doc) => {
    fieldRow(doc, [
      { label: 'Nome completo:', value: readerName },
      { label: 'Código:', value: `LTR-${String(loan.readerId).padStart(6, '0')}` },
    ], doc.y);
  });

  y = section(doc, y, '4. Material Bibliográfico', (doc) => {
    fieldRow(doc, [
      { label: 'Título:', value: bookTitle },
      { label: 'Autor(es):', value: bookAuthor },
    ], doc.y);
    doc.y += 16;
    fieldRow(doc, [
      { label: 'ISBN:', value: bookIsbn },
      { label: 'Código/Tombo:', value: `#${bookNumber}` },
    ], doc.y);
  });

  y = section(doc, y, '5. Registro da Devolução', (doc) => {
    doc.save().fontSize(7.5).font(FF.regular).fillColor(C.ink);
    doc.text(
      'Declaro, para os devidos fins, que o material bibliográfico identificado neste documento foi recebido pela biblioteca na data e horário registrados neste termo, ficando encerrada a operação de empréstimo correspondente, ressalvadas eventuais pendências ou ocorrências expressamente registradas neste documento.',
      M.contentLeft, doc.y, { width: M.contentWidth, lineGap: 1.5 }
    );
    doc.restore();
  });

  y = section(doc, y, '6. Responsável pelo Recebimento', (doc) => {
    fieldRow(doc, [
      { label: 'Servidor/Responsável:', value: receivedByName },
      { label: 'Data/Hora do registro:', value: loan.returnedAt ? formatDateTime(loan.returnedAt) : '—' },
    ], doc.y);
  });

  section(doc, y, '7. Assinaturas', (doc) => {
    const sy = doc.y + 6;
    const sigH = 42;
    if (loan.returnSignature && drawSignature(doc, loan.returnSignature, 60, sy, 200, sigH)) {
      doc.save().fontSize(6.5).font(FF.regular).fillColor(C.gray);
      doc.text('Leitor / Responsável (digital)', 60, sy + sigH + 2);
      doc.text(readerName, 60, doc.y + 8);
      if (loan.returnSignedAt) doc.text(`Assinado em ${formatDateTime(loan.returnSignedAt)}`, 60, doc.y + 8);
      doc.restore();
    } else {
      doc.save().fontSize(7.5).font(FF.regular).fillColor(C.ink);
      doc.text('________________________________', 60, sy);
      doc.fontSize(6.5).fillColor(C.gray).text('Leitor / Responsável', 60, doc.y + 1);
      doc.text(readerName, 60, doc.y + 8);
      doc.restore();
    }
    const leftEnd = doc.y + 5;
    doc.save().fontSize(7.5).font(FF.regular).fillColor(C.ink);
    if (loan.receivedBySignatureSnapshot && drawSignature(doc, loan.receivedBySignatureSnapshot, 300, sy, 200, sigH)) {
      doc.fontSize(6.5).fillColor(C.gray).text('Servidor responsável pelo recebimento (digital)', 300, sy + sigH + 2);
      doc.text(receivedByName, 300, doc.y + 8);
    } else {
      doc.text('________________________________', 300, sy);
      doc.fontSize(6.5).fillColor(C.gray).text('Servidor responsável pelo recebimento', 300, doc.y + 1);
      doc.text(receivedByName, 300, doc.y + 8);
    }
    doc.restore();
    doc.y = Math.max(sy + 40, leftEnd, doc.y + 5);
  });

  drawFooter(doc, code, loan.returnedAt || new Date(), loanNum, receivedByName);
  return doc;
}

export function generateBatchReturnTermPDF(loans: LoanTermData[], settings: LibrarySettings): typeof PDFDocument {
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
  useFonts(doc);
  const first = loans[0];
  const group = first.returnGroup || `DEV-${String(first.id).padStart(6, '0')}`;
  const maxReturnedAt = loans.reduce<Date>(
    (acc, l) => (l.returnedAt && new Date(l.returnedAt) > acc ? new Date(l.returnedAt) : acc),
    new Date(first.returnedAt || new Date()),
  );
  const code = verificationCode('DEV', first.id, maxReturnedAt);

  const readerName = first.readerNameSnapshot || first.reader?.name || '—';
  const receivedByName = first.receivedByNameSnapshot || '—';
  const returnSig = loans.map((l) => l.returnSignature).find(Boolean) || null;
  const returnSignedAt = loans.map((l) => l.returnSignedAt).find(Boolean) || null;
  const receivedBySig = loans.map((l) => l.receivedBySignatureSnapshot).find(Boolean) || null;
  const overdueCount = loans.filter((l) => l.returnedAt && new Date(l.returnedAt) > new Date(l.dueDate)).length;
  const statusText = overdueCount > 0
    ? `DEVOLUÇÃO EM LOTE — ${overdueCount} DE ${loans.length} COM ATRASO`
    : `DEVOLUÇÃO EM LOTE — ${loans.length} NO PRAZO`;
  const statusColor = overdueCount > 0 ? '#DC2626' : '#16A34A';
  const condMap: Record<string, string> = { 'BOM': 'Bom estado', 'REGULAR': 'Regular', 'DANIFICADO': 'Danificado' };
  const condLabel = first.returnCondition ? (condMap[first.returnCondition] || first.returnCondition) : 'Não informado';

  const hY = drawHeader(doc, settings);
  doc.y = hY; doc.x = 50;
  doc.fontSize(15).font(FF.bold).fillColor(C.ink).text('TERMO DE DEVOLUÇÃO', { align: 'center' });
  doc.fontSize(9).font(FF.regular).fillColor(C.primary).text(`${group} · ${loans.length} ${loans.length === 1 ? 'livro' : 'livros'}`, { align: 'center' });
  doc.moveDown(0.3);

  let y = doc.y + 2;

  y = section(doc, y, '1. Situação e Condição', (doc) => {
    doc.save().fontSize(9.5).font(FF.bold).fillColor(statusColor).text(statusText, M.contentLeft, doc.y, { width: M.contentWidth });
    doc.restore();
    doc.y += 10;
    fieldRow(doc, [
      { label: 'Condição do material:', value: condLabel },
      { label: 'Devolução efetiva:', value: formatDateTime(maxReturnedAt) },
    ], doc.y);
    if (first.returnObservations) {
      doc.y += 16;
      doc.save().fontSize(6.5).font(FF.regular).fillColor(C.gray).text('OCORRÊNCIAS:', M.contentLeft, doc.y);
      doc.fontSize(8).font(FF.bold).fillColor(C.ink).text(first.returnObservations, M.contentLeft, doc.y + 1.5, { width: M.contentWidth, lineGap: 1 });
      doc.restore();
    }
  });

  y = section(doc, y, '2. Leitor', (doc) => {
    fieldRow(doc, [
      { label: 'Nome completo:', value: readerName },
      { label: 'Código:', value: `LTR-${String(first.readerId).padStart(6, '0')}` },
    ], doc.y);
  });

  y = section(doc, y, '3. Materiais Devolvidos', (doc) => {
    loans.forEach((loan, i) => {
      const title = loan.bookTitleSnapshot || loan.book?.title || '—';
      const author = loan.bookAuthorSnapshot || '—';
      const isbn = loan.bookIsbnSnapshot || loan.book?.isbn13 || loan.book?.isbn10 || '—';
      const num = loan.number || `EMP-${String(loan.id).padStart(6, '0')}`;
      const late = loan.returnedAt && new Date(loan.returnedAt) > new Date(loan.dueDate);
      if (i > 0) doc.y += 8;
      doc.save().fontSize(8).font(FF.bold).fillColor(C.ink)
        .text(`${i + 1}. ${title}`, M.contentLeft, doc.y, { width: M.contentWidth });
      doc.fontSize(7).font(FF.regular).fillColor(late ? '#DC2626' : C.gray)
        .text(`${author}  ·  ISBN ${isbn}  ·  ${num}  ·  ${late ? 'com atraso' : 'no prazo'}`, M.contentLeft, doc.y + 1, { width: M.contentWidth });
      doc.restore();
    });
  });

  y = section(doc, y, '4. Registro da Devolução', (doc) => {
    doc.save().fontSize(7.5).font(FF.regular).fillColor(C.ink);
    doc.text(
      `Declaro, para os devidos fins, que os ${loans.length} materiais bibliográficos identificados neste documento foram recebidos pela biblioteca na data e horário registrados neste termo, ficando encerradas as operações de empréstimo correspondentes, ressalvadas eventuais pendências ou ocorrências expressamente registradas neste documento.`,
      M.contentLeft, doc.y, { width: M.contentWidth, lineGap: 1.5 }
    );
    doc.restore();
  });

  y = section(doc, y, '5. Responsável pelo Recebimento', (doc) => {
    fieldRow(doc, [
      { label: 'Servidor/Responsável:', value: receivedByName },
      { label: 'Data/Hora do registro:', value: formatDateTime(maxReturnedAt) },
    ], doc.y);
  });

  section(doc, y, '6. Assinaturas', (doc) => {
    const sy = doc.y + 6;
    const sigH = 42;
    if (returnSig && drawSignature(doc, returnSig, 60, sy, 200, sigH)) {
      doc.save().fontSize(6.5).font(FF.regular).fillColor(C.gray);
      doc.text('Leitor / Responsável (digital)', 60, sy + sigH + 2);
      doc.text(readerName, 60, doc.y + 8);
      if (returnSignedAt) doc.text(`Assinado em ${formatDateTime(returnSignedAt)}`, 60, doc.y + 8);
      doc.restore();
    } else {
      doc.save().fontSize(7.5).font(FF.regular).fillColor(C.ink);
      doc.text('________________________________', 60, sy);
      doc.fontSize(6.5).fillColor(C.gray).text('Leitor / Responsável', 60, doc.y + 1);
      doc.text(readerName, 60, doc.y + 8);
      doc.restore();
    }
    const leftEnd = doc.y + 5;
    doc.save().fontSize(7.5).font(FF.regular).fillColor(C.ink);
    if (receivedBySig && drawSignature(doc, receivedBySig, 300, sy, 200, sigH)) {
      doc.fontSize(6.5).fillColor(C.gray).text('Servidor responsável pelo recebimento (digital)', 300, sy + sigH + 2);
      doc.text(receivedByName, 300, doc.y + 8);
    } else {
      doc.text('________________________________', 300, sy);
      doc.fontSize(6.5).fillColor(C.gray).text('Servidor responsável pelo recebimento', 300, doc.y + 1);
      doc.text(receivedByName, 300, doc.y + 8);
    }
    doc.restore();
    doc.y = Math.max(sy + 40, leftEnd, doc.y + 5);
  });

  drawFooter(doc, code, maxReturnedAt, group, receivedByName);
  return doc;
}
