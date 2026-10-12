import { Pdf, hex, sanitizeWinAnsi } from './pdf';

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
  primary: hex('#087F8C'),
  ink: hex('#1A1A1A'),
  gray: hex('#6B7280'),
  grayLight: hex('#E5E7EB'),
  white: hex('#FFFFFF'),
};

const M = { left: 50, right: 545, contentLeft: 60, contentWidth: 485 };

/** Texto dinâmico seguro p/ WinAnsi (nomes/títulos podem ter Unicode exótico). */
const T = (v: string | null | undefined): string => sanitizeWinAnsi(v ?? '');

function formatDate(d: Date | string): string {
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTime(d: Date | string): string {
  return new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function verificationCode(prefix: string, id: number, date: Date | string | number): Promise<string> {
  const dd = new Date(date);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${prefix}-${id}-${dd.getTime()}`),
  );
  const hexStr = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}-${dd.getFullYear()}-${String(id).padStart(6, '0')}-${hexStr.slice(0, 6).toUpperCase()}`;
}

function drawBookIcon(pdf: Pdf, x: number, y: number, size: number) {
  const s = size, sx = s / 24, sy = s / 24;
  pdf.roundedRect(x, y, s, s, 3, { fill: C.primary });
  const W = C.white;
  const segs: Array<[number, number, number, number]> = [
    [12, 7, 12, 21],
    [2, 4, 2, 17], [2, 17, 4, 19], [4, 19, 9, 21], [9, 21, 12, 7],
    [12, 7, 15, 21], [15, 21, 20, 19], [20, 19, 22, 17],
    [22, 17, 22, 4], [22, 4, 20, 3], [20, 3, 16, 3], [16, 3, 12, 7],
    [12, 7, 8, 3], [8, 3, 4, 3],
  ];
  for (const [x1, y1, x2, y2] of segs) {
    pdf.line(x + x1 * sx, y + y1 * sy, x + x2 * sx, y + y2 * sy, W, 1.4);
  }
}

function drawHeader(pdf: Pdf, s: LibrarySettings): number {
  drawBookIcon(pdf, 50, 32, 30);
  pdf.text(T(s.libraryName) || 'Biblioteca Pública', 88, 35, { size: 12, font: 'bold', color: C.ink, width: 320 });
  pdf.text('Página 1 de 1', 420, 38, { size: 6.5, color: C.gray, width: 125, align: 'right' });
  const parts: string[] = [];
  if (s.libraryAddress) parts.push(T(s.libraryAddress));
  if (s.libraryPhone) parts.push(`Tel: ${T(s.libraryPhone)}`);
  if (s.libraryEmail) parts.push(T(s.libraryEmail));
  let y = 35 + 12 * 1.2 + 7 * 1.2 + 1;
  if (parts.length) y = pdf.text(parts.join('  |  '), 88, y, { size: 7, color: C.gray, width: 420 });
  const ly = Math.max(y + 5, 74);
  pdf.line(50, ly, 545, ly, C.primary, 0.8);
  return ly + 8;
}

async function section(
  pdf: Pdf,
  y: number,
  title: string,
  h: (pdf: Pdf) => void | Promise<void>,
): Promise<number> {
  pdf.text(title.toUpperCase(), 54, y + 6, { size: 8, font: 'bold', color: C.primary });
  pdf.y = y + 18;
  await h(pdf);
  const ey = pdf.y + 5;
  pdf.roundedRect(50, y, 495, ey - y, 3, { borderColor: C.grayLight, borderWidth: 0.4 });
  return ey + 4;
}

function field(pdf: Pdf, label: string, value: string, x: number, y: number, w: number) {
  const y1 = pdf.text(label, x, y, { size: 6.5, color: C.gray, width: w });
  pdf.y = pdf.text(value || '—', x, y1 + 0.5, { size: 8.5, font: 'bold', color: C.ink, width: w });
}

function fieldRow(pdf: Pdf, fields: { label: string; value: string }[], y: number) {
  const n = fields.length;
  const totalW = M.contentWidth;
  const gap = 12;
  const colW = (totalW - gap * (n - 1)) / n;
  fields.forEach((f, i) => field(pdf, f.label, f.value, M.contentLeft + i * (colW + gap), y, colW));
}

function drawFooter(pdf: Pdf, code: string, at: Date, num: string | null, by: string | null) {
  const fy = 755;
  pdf.line(50, fy, 545, fy, C.grayLight, 0.4);
  pdf.text(`Código de verificação: ${code}`, 50, fy + 5, { size: 6.5, color: C.gray, width: 260 });
  pdf.text('Documento gerado eletronicamente pelo Sistema de Gestão da Biblioteca.', 50, fy + 14, { size: 6.5, color: C.gray, width: 260 });
  pdf.text(`Emitido em ${formatDateTime(at)}`, 340, fy + 5, { size: 6.5, color: C.gray, width: 205, align: 'right' });
  if (num) pdf.text(`Empréstimo: ${T(num)}`, 340, fy + 14, { size: 6.5, color: C.gray, width: 205, align: 'right' });
  if (by) pdf.text(`Registrado por: ${T(by)}`, 340, fy + 23, { size: 6.5, color: C.gray, width: 205, align: 'right' });
}

// Desenha a assinatura digital (PNG data-URL) na caixa (x, y, w, h).
// Retorna false quando ausente/inválida — o chamador mantém as linhas manuais.
async function drawSignature(
  pdf: Pdf,
  dataUrl: string | null | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
): Promise<boolean> {
  const bytes = Pdf.imageBytes(dataUrl);
  if (!bytes) return false;
  return pdf.drawImage(bytes, x, y, w, h);
}

export async function generateLoanTermPDF(
  loan: LoanTermData,
  settings: LibrarySettings,
): Promise<Uint8Array> {
  const pdf = await Pdf.create();
  pdf.addPage(595.28, 841.89);
  const num = loan.number || `EMP-${String(loan.id).padStart(6, '0')}`;
  const code = await verificationCode('EMP', loan.id, loan.createdAt);

  const readerName = T(loan.readerNameSnapshot || loan.reader?.name || '—');
  const bookTitle = T(loan.bookTitleSnapshot || loan.book?.title || '—');
  const bookAuthor = T(loan.bookAuthorSnapshot || '—');
  const bookIsbn = T(loan.bookIsbnSnapshot || loan.book?.isbn13 || loan.book?.isbn10 || '—');
  const bookNumber = T(loan.bookNumberSnapshot || String(loan.bookId));
  const createdByName = T(loan.createdByNameSnapshot || loan.user?.name || '—');

  const hY = drawHeader(pdf, settings);
  pdf.y = hY;
  let ty = pdf.text('TERMO DE EMPRÉSTIMO', 50, hY, { size: 15, font: 'bold', color: C.ink, width: 495, align: 'center' });
  ty = pdf.text(T(num), 50, ty, { size: 9, color: C.primary, width: 495, align: 'center' });
  pdf.y = ty + 4;

  let y = pdf.y + 2;

  y = await section(pdf, y, '1. Empréstimo', (doc) => {
    fieldRow(doc, [
      { label: 'Número:', value: T(num) },
      { label: 'Data/Hora:', value: formatDateTime(loan.createdAt) },
      { label: 'Previsão devolução:', value: formatDate(loan.dueDate) },
    ], doc.y);
  });

  y = await section(pdf, y, '2. Leitor', (doc) => {
    fieldRow(doc, [
      { label: 'Nome completo:', value: readerName },
      { label: 'Código:', value: `LTR-${String(loan.readerId).padStart(6, '0')}` },
    ], doc.y);
  });

  y = await section(pdf, y, '3. Material Bibliográfico', (doc) => {
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

  y = await section(pdf, y, '4. Registro do Atendimento', (doc) => {
    fieldRow(doc, [
      { label: 'Servidor/Responsável:', value: createdByName },
      { label: 'Data do empréstimo:', value: formatDate(loan.loanDate) },
    ], doc.y);
    doc.y += 16;
    doc.text(
      'Declaro que o material acima foi recebido pelo leitor na data indicada, comprometendo-se à devolução no prazo estabelecido.',
      M.contentLeft, doc.y, { size: 7.5, color: C.ink, width: M.contentWidth, lineGap: 1.5 },
    );
  });

  await section(pdf, y, '5. Assinaturas', async (doc) => {
    const sy = doc.y + 6;
    const sigH = 42;
    if (loan.loanSignature && (await drawSignature(doc, loan.loanSignature, 60, sy, 200, sigH))) {
      doc.text('Assinatura do Leitor (digital)', 60, sy + sigH + 2, { size: 6.5, color: C.gray });
      let ny = doc.text(readerName, 60, doc.y + 8, { size: 8.5, font: 'bold', color: C.ink });
      if (loan.loanSignedAt) ny = doc.text(`Assinado em ${formatDateTime(loan.loanSignedAt)}`, 60, ny + 8, { size: 6.5, color: C.gray });
      doc.y = ny;
    } else {
      doc.text('________________________________', 60, sy, { size: 7.5, color: C.ink });
      let ny = doc.text('Assinatura do Leitor', 60, doc.y + 1, { size: 6.5, color: C.gray });
      ny = doc.text(readerName, 60, ny + 8, { size: 8.5, font: 'bold', color: C.ink });
      doc.y = ny;
    }
    const leftEnd = doc.y + 5;
    if (loan.createdBySignatureSnapshot && (await drawSignature(doc, loan.createdBySignatureSnapshot, 300, sy, 200, sigH))) {
      let ny = doc.text('Responsável pelo atendimento (digital)', 300, sy + sigH + 2, { size: 6.5, color: C.gray });
      ny = doc.text(createdByName, 300, ny + 8, { size: 8.5, font: 'bold', color: C.ink });
      doc.y = ny;
    } else {
      let ny = doc.text('________________________________', 300, sy, { size: 7.5, color: C.ink });
      ny = doc.text('Responsável pelo atendimento', 300, ny + 1, { size: 6.5, color: C.gray });
      ny = doc.text(createdByName, 300, ny + 8, { size: 8.5, font: 'bold', color: C.ink });
      doc.y = ny;
    }
    doc.y = Math.max(sy + 40, leftEnd, doc.y + 5);
  });

  drawFooter(pdf, code, loan.createdAt, num, createdByName);
  return pdf.save();
}

export async function generateReturnTermPDF(
  loan: LoanTermData,
  settings: LibrarySettings,
): Promise<Uint8Array> {
  const pdf = await Pdf.create();
  pdf.addPage(595.28, 841.89);

  const loanNum = loan.number || `EMP-${String(loan.id).padStart(6, '0')}`;
  const retNum = `DEV-${String(loan.id).padStart(6, '0')}`;
  const code = await verificationCode('DEV', loan.id, loan.returnedAt || new Date());

  const readerName = T(loan.readerNameSnapshot || loan.reader?.name || '—');
  const bookTitle = T(loan.bookTitleSnapshot || loan.book?.title || '—');
  const bookAuthor = T(loan.bookAuthorSnapshot || '—');
  const bookIsbn = T(loan.bookIsbnSnapshot || loan.book?.isbn13 || loan.book?.isbn10 || '—');
  const bookNumber = T(loan.bookNumberSnapshot || String(loan.bookId));
  const receivedByName = T(loan.receivedByNameSnapshot || '—');

  const loanDays = loan.returnedAt
    ? Math.ceil((new Date(loan.returnedAt).getTime() - new Date(loan.loanDate).getTime()) / 86400000) : 0;
  const isOverdue = loan.returnedAt && new Date(loan.returnedAt) > new Date(loan.dueDate);
  const lateDays = isOverdue
    ? Math.ceil((new Date(loan.returnedAt!).getTime() - new Date(loan.dueDate).getTime()) / 86400000) : 0;

  const statusText = isOverdue ? `DEVOLVIDO COM ATRASO (${lateDays} dia(s))` : 'DEVOLVIDO NO PRAZO';
  const statusColor = isOverdue ? hex('#DC2626') : hex('#16A34A');
  const condMap: Record<string, string> = { 'BOM': 'Bom estado', 'REGULAR': 'Regular', 'DANIFICADO': 'Danificado' };
  const condLabel = loan.returnCondition ? (condMap[loan.returnCondition] || loan.returnCondition) : 'Não informado';

  const hY = drawHeader(pdf, settings);
  pdf.y = hY;
  let ty = pdf.text('TERMO DE DEVOLUÇÃO', 50, hY, { size: 15, font: 'bold', color: C.ink, width: 495, align: 'center' });
  ty = pdf.text(T(retNum), 50, ty, { size: 9, color: C.primary, width: 495, align: 'center' });
  pdf.y = ty + 4;

  let y = pdf.y + 2;

  y = await section(pdf, y, '1. Situação e Condição', (doc) => {
    doc.text(statusText, M.contentLeft, doc.y, { size: 9.5, font: 'bold', color: statusColor, width: M.contentWidth });
    doc.y += 10;
    fieldRow(doc, [
      { label: 'Condição do material:', value: T(condLabel) },
    ], doc.y);
    if (loan.returnObservations) {
      doc.y += 16;
      let ny = doc.text('OCORRÊNCIAS:', M.contentLeft, doc.y, { size: 6.5, color: C.gray });
      ny = doc.text(T(loan.returnObservations), M.contentLeft, ny + 1.5, { size: 8, font: 'bold', color: C.ink, width: M.contentWidth, lineGap: 1 });
      doc.y = ny;
    }
  });

  y = await section(pdf, y, '2. Empréstimo', (doc) => {
    fieldRow(doc, [
      { label: 'Empréstimo:', value: T(loanNum) },
      { label: 'Devolução:', value: T(retNum) },
      { label: 'Dias de empréstimo:', value: `${loanDays} dia(s)` },
    ], doc.y);
    doc.y += 16;
    fieldRow(doc, [
      { label: 'Data do empréstimo:', value: formatDate(loan.loanDate) },
      { label: 'Previsão devolução:', value: formatDate(loan.dueDate) },
      { label: 'Devolução efetiva:', value: loan.returnedAt ? formatDateTime(loan.returnedAt) : '—' },
    ], doc.y);
  });

  y = await section(pdf, y, '3. Leitor', (doc) => {
    fieldRow(doc, [
      { label: 'Nome completo:', value: readerName },
      { label: 'Código:', value: `LTR-${String(loan.readerId).padStart(6, '0')}` },
    ], doc.y);
  });

  y = await section(pdf, y, '4. Material Bibliográfico', (doc) => {
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

  y = await section(pdf, y, '5. Registro da Devolução', (doc) => {
    doc.text(
      'Declaro, para os devidos fins, que o material bibliográfico identificado neste documento foi recebido pela biblioteca na data e horário registrados neste termo, ficando encerrada a operação de empréstimo correspondente, ressalvadas eventuais pendências ou ocorrências expressamente registradas neste documento.',
      M.contentLeft, doc.y, { size: 7.5, color: C.ink, width: M.contentWidth, lineGap: 1.5 },
    );
  });

  y = await section(pdf, y, '6. Responsável pelo Recebimento', (doc) => {
    fieldRow(doc, [
      { label: 'Servidor/Responsável:', value: receivedByName },
      { label: 'Data/Hora do registro:', value: loan.returnedAt ? formatDateTime(loan.returnedAt) : '—' },
    ], doc.y);
  });

  await section(pdf, y, '7. Assinaturas', async (doc) => {
    const sy = doc.y + 6;
    const sigH = 42;
    if (loan.returnSignature && (await drawSignature(doc, loan.returnSignature, 60, sy, 200, sigH))) {
      let ny = doc.text('Leitor / Responsável (digital)', 60, sy + sigH + 2, { size: 6.5, color: C.gray });
      ny = doc.text(readerName, 60, ny + 8, { size: 8.5, font: 'bold', color: C.ink });
      if (loan.returnSignedAt) ny = doc.text(`Assinado em ${formatDateTime(loan.returnSignedAt)}`, 60, ny + 8, { size: 6.5, color: C.gray });
      doc.y = ny;
    } else {
      let ny = doc.text('________________________________', 60, sy, { size: 7.5, color: C.ink });
      ny = doc.text('Leitor / Responsável', 60, ny + 1, { size: 6.5, color: C.gray });
      ny = doc.text(readerName, 60, ny + 8, { size: 8.5, font: 'bold', color: C.ink });
      doc.y = ny;
    }
    const leftEnd = doc.y + 5;
    if (loan.receivedBySignatureSnapshot && (await drawSignature(doc, loan.receivedBySignatureSnapshot, 300, sy, 200, sigH))) {
      let ny = doc.text('Servidor responsável pelo recebimento (digital)', 300, sy + sigH + 2, { size: 6.5, color: C.gray });
      ny = doc.text(receivedByName, 300, ny + 8, { size: 8.5, font: 'bold', color: C.ink });
      doc.y = ny;
    } else {
      let ny = doc.text('________________________________', 300, sy, { size: 7.5, color: C.ink });
      ny = doc.text('Servidor responsável pelo recebimento', 300, ny + 1, { size: 6.5, color: C.gray });
      ny = doc.text(receivedByName, 300, ny + 8, { size: 8.5, font: 'bold', color: C.ink });
      doc.y = ny;
    }
    doc.y = Math.max(sy + 40, leftEnd, doc.y + 5);
  });

  drawFooter(pdf, code, loan.returnedAt || new Date(), loanNum, receivedByName);
  return pdf.save();
}

export async function generateBatchReturnTermPDF(
  loans: LoanTermData[],
  settings: LibrarySettings,
): Promise<Uint8Array> {
  const pdf = await Pdf.create();
  pdf.addPage(595.28, 841.89);
  const first = loans[0];
  const group = first.returnGroup || `DEV-${String(first.id).padStart(6, '0')}`;
  const maxReturnedAt = loans.reduce<Date>(
    (acc, l) => (l.returnedAt && new Date(l.returnedAt) > acc ? new Date(l.returnedAt) : acc),
    new Date(first.returnedAt || new Date()),
  );
  const code = await verificationCode('DEV', first.id, maxReturnedAt);

  const readerName = T(first.readerNameSnapshot || first.reader?.name || '—');
  const receivedByName = T(first.receivedByNameSnapshot || '—');
  const returnSig = loans.map((l) => l.returnSignature).find(Boolean) || null;
  const returnSignedAt = loans.map((l) => l.returnSignedAt).find(Boolean) || null;
  const receivedBySig = loans.map((l) => l.receivedBySignatureSnapshot).find(Boolean) || null;
  const overdueCount = loans.filter((l) => l.returnedAt && new Date(l.returnedAt) > new Date(l.dueDate)).length;
  const statusText = overdueCount > 0
    ? `DEVOLUÇÃO EM LOTE — ${overdueCount} DE ${loans.length} COM ATRASO`
    : `DEVOLUÇÃO EM LOTE — ${loans.length} NO PRAZO`;
  const statusColor = overdueCount > 0 ? hex('#DC2626') : hex('#16A34A');
  const condMap: Record<string, string> = { 'BOM': 'Bom estado', 'REGULAR': 'Regular', 'DANIFICADO': 'Danificado' };
  const condLabel = first.returnCondition ? (condMap[first.returnCondition] || first.returnCondition) : 'Não informado';

  const hY = drawHeader(pdf, settings);
  pdf.y = hY;
  let ty = pdf.text('TERMO DE DEVOLUÇÃO', 50, hY, { size: 15, font: 'bold', color: C.ink, width: 495, align: 'center' });
  ty = pdf.text(T(`${group} · ${loans.length} ${loans.length === 1 ? 'livro' : 'livros'}`), 50, ty, { size: 9, color: C.primary, width: 495, align: 'center' });
  pdf.y = ty + 4;

  let y = pdf.y + 2;

  y = await section(pdf, y, '1. Situação e Condição', (doc) => {
    doc.text(statusText, M.contentLeft, doc.y, { size: 9.5, font: 'bold', color: statusColor, width: M.contentWidth });
    doc.y += 10;
    fieldRow(doc, [
      { label: 'Condição do material:', value: T(condLabel) },
      { label: 'Devolução efetiva:', value: formatDateTime(maxReturnedAt) },
    ], doc.y);
    if (first.returnObservations) {
      doc.y += 16;
      let ny = doc.text('OCORRÊNCIAS:', M.contentLeft, doc.y, { size: 6.5, color: C.gray });
      ny = doc.text(T(first.returnObservations), M.contentLeft, ny + 1.5, { size: 8, font: 'bold', color: C.ink, width: M.contentWidth, lineGap: 1 });
      doc.y = ny;
    }
  });

  y = await section(pdf, y, '2. Leitor', (doc) => {
    fieldRow(doc, [
      { label: 'Nome completo:', value: readerName },
      { label: 'Código:', value: `LTR-${String(first.readerId).padStart(6, '0')}` },
    ], doc.y);
  });

  y = await section(pdf, y, '3. Materiais Devolvidos', (doc) => {
    loans.forEach((loan, i) => {
      const title = T(loan.bookTitleSnapshot || loan.book?.title || '—');
      const author = T(loan.bookAuthorSnapshot || '—');
      const isbn = T(loan.bookIsbnSnapshot || loan.book?.isbn13 || loan.book?.isbn10 || '—');
      const num = T(loan.number || `EMP-${String(loan.id).padStart(6, '0')}`);
      const late = loan.returnedAt && new Date(loan.returnedAt) > new Date(loan.dueDate);
      if (i > 0) doc.y += 8;
      doc.text(`${i + 1}. ${title}`, M.contentLeft, doc.y, { size: 8, font: 'bold', color: C.ink, width: M.contentWidth });
      const lateColor = late ? hex('#DC2626') : C.gray;
      doc.text(`${author}  ·  ISBN ${isbn}  ·  ${num}  ·  ${late ? 'com atraso' : 'no prazo'}`, M.contentLeft, doc.y + 1, { size: 7, color: lateColor, width: M.contentWidth });
    });
  });

  y = await section(pdf, y, '4. Registro da Devolução', (doc) => {
    doc.text(
      `Declaro, para os devidos fins, que os ${loans.length} materiais bibliográficos identificados neste documento foram recebidos pela biblioteca na data e horário registrados neste termo, ficando encerradas as operações de empréstimo correspondentes, ressalvadas eventuais pendências ou ocorrências expressamente registradas neste documento.`,
      M.contentLeft, doc.y, { size: 7.5, color: C.ink, width: M.contentWidth, lineGap: 1.5 },
    );
  });

  y = await section(pdf, y, '5. Responsável pelo Recebimento', (doc) => {
    fieldRow(doc, [
      { label: 'Servidor/Responsável:', value: receivedByName },
      { label: 'Data/Hora do registro:', value: formatDateTime(maxReturnedAt) },
    ], doc.y);
  });

  await section(pdf, y, '6. Assinaturas', async (doc) => {
    const sy = doc.y + 6;
    const sigH = 42;
    if (returnSig && (await drawSignature(doc, returnSig, 60, sy, 200, sigH))) {
      let ny = doc.text('Leitor / Responsável (digital)', 60, sy + sigH + 2, { size: 6.5, color: C.gray });
      ny = doc.text(readerName, 60, ny + 8, { size: 8.5, font: 'bold', color: C.ink });
      if (returnSignedAt) ny = doc.text(`Assinado em ${formatDateTime(returnSignedAt)}`, 60, ny + 8, { size: 6.5, color: C.gray });
      doc.y = ny;
    } else {
      let ny = doc.text('________________________________', 60, sy, { size: 7.5, color: C.ink });
      ny = doc.text('Leitor / Responsável', 60, ny + 1, { size: 6.5, color: C.gray });
      ny = doc.text(readerName, 60, ny + 8, { size: 8.5, font: 'bold', color: C.ink });
      doc.y = ny;
    }
    const leftEnd = doc.y + 5;
    if (receivedBySig && (await drawSignature(doc, receivedBySig, 300, sy, 200, sigH))) {
      let ny = doc.text('Servidor responsável pelo recebimento (digital)', 300, sy + sigH + 2, { size: 6.5, color: C.gray });
      ny = doc.text(receivedByName, 300, ny + 8, { size: 8.5, font: 'bold', color: C.ink });
      doc.y = ny;
    } else {
      let ny = doc.text('________________________________', 300, sy, { size: 7.5, color: C.ink });
      ny = doc.text('Servidor responsável pelo recebimento', 300, ny + 1, { size: 6.5, color: C.gray });
      ny = doc.text(receivedByName, 300, ny + 8, { size: 8.5, font: 'bold', color: C.ink });
      doc.y = ny;
    }
    doc.y = Math.max(sy + 40, leftEnd, doc.y + 5);
  });

  drawFooter(pdf, code, maxReturnedAt, group, receivedByName);
  return pdf.save();
}
