/**
 * Toolkit pdf-lib com coordenadas top-down (origem no canto superior esquerdo),
 * mesma convenção do pdfkit — para traduzir os geradores com fidelidade.
 * Funciona em Node e Workers (sem `fs`, sem fontes externas: Helvetica WinAnsi).
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';

export { PDFDocument };
export type { RGB };

export const A4_W = 595.28;
export const A4_H = 841.89;

/** Converte '#RRGGBB' em cor pdf-lib. */
export function hex(h: string): RGB {
  const n = h.replace('#', '');
  const v = (i: number) => parseInt(n.slice(i, i + 2), 16) / 255;
  return rgb(v(0), v(2), v(4));
}

const WIN_ANSI_EXTRA = new Set([
  0x152, 0x153, 0x160, 0x161, 0x178, 0x17d, 0x17e, 0x192, 0x2c6, 0x2dc,
  0x2013, 0x2014, 0x2018, 0x2019, 0x201a, 0x201c, 0x201d, 0x201e,
  0x2020, 0x2021, 0x2022, 0x2026, 0x2030, 0x2039, 0x203a, 0x20ac, 0x2122,
]);

/**
 * WinAnsi não cobre emoji/CJK/cirílico — pdf-lib LANÇA ao codificar.
 * Controles viram espaço; o resto fora do WinAnsi vira '?'.
 */
export function sanitizeWinAnsi(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) out += ' ';
    else if (cp <= 0xff || WIN_ANSI_EXTRA.has(cp)) out += ch;
    else out += '?';
  }
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface PdfFonts {
  regular: PDFFont;
  bold: PDFFont;
}

export type FontName = keyof PdfFonts;

export interface TextOpts {
  size: number;
  font?: FontName;
  color?: RGB;
  width?: number;
  align?: 'left' | 'center' | 'right';
  lineGap?: number;
}

const LINE_HEIGHT = 1.2;
/** Ascendente Helvetica/Helvetica-Bold (fração do tamanho) — topo da tinta. */
const HELVETICA_ASCENT = 0.718;

function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let cur = '';
  const push = (line: string) => {
    if (line) lines.push(line);
  };
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(t, size) <= maxWidth) {
      cur = t;
      continue;
    }
    push(cur);
    // Palavra maior que a largura: quebra dura por caractere.
    let rest = w;
    cur = '';
    while (rest && font.widthOfTextAtSize(rest, size) > maxWidth) {
      let i = 1;
      while (i < rest.length && font.widthOfTextAtSize(rest.slice(0, i + 1), size) <= maxWidth) i++;
      push(rest.slice(0, i));
      rest = rest.slice(i);
    }
    cur = rest;
  }
  push(cur);
  return lines.length > 0 ? lines : [''];
}

export class Pdf {
  readonly doc: PDFDocument;
  readonly fonts: PdfFonts;
  page!: PDFPage;
  W = 0;
  H = 0;
  /** Cursor vertical top-down (equivale ao doc.y do pdfkit). */
  y = 0;
  x = 0;

  private constructor(doc: PDFDocument, fonts: PdfFonts) {
    this.doc = doc;
    this.fonts = fonts;
  }

  static async create(): Promise<Pdf> {
    const doc = await PDFDocument.create();
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    return new Pdf(doc, { regular, bold });
  }

  addPage(w: number, h: number): void {
    this.page = this.doc.addPage([w, h]);
    this.W = w;
    this.H = h;
    this.y = 0;
    this.x = 0;
  }

  private lineHeight(size: number, lineGap?: number): number {
    return size * LINE_HEIGHT + (lineGap ?? 0);
  }

  heightOf(text: string, size: number, font: FontName, width: number, lineGap?: number): number {
    const f = this.fonts[font];
    return wrapLines(text, f, size, width).length * this.lineHeight(size, lineGap);
  }

  /**
   * Desenha texto com (x, yTop) no topo — retorna a nova posição y (topo da próxima linha).
   */
  text(str: string, x: number, yTop: number, o: TextOpts): number {
    const font = this.fonts[o.font ?? 'regular'];
    const width = o.width ?? this.W - x;
    const lines = wrapLines(str, font, o.size, width);
    const lh = this.lineHeight(o.size, o.lineGap);
    const ascent = o.size * HELVETICA_ASCENT;
    lines.forEach((line, i) => {
      const w = font.widthOfTextAtSize(line, o.size);
      const dx =
        o.align === 'center' ? x + Math.max(0, (width - w) / 2) : o.align === 'right' ? x + Math.max(0, width - w) : x;
      this.page.drawText(line, {
        x: dx,
        y: this.H - yTop - ascent - i * lh,
        size: o.size,
        font,
        color: o.color,
      });
    });
    return yTop + lines.length * lh;
  }

  line(x1: number, y1: number, x2: number, y2: number, color: RGB, width: number): void {
    this.page.drawLine({
      start: { x: x1, y: this.H - y1 },
      end: { x: x2, y: this.H - y2 },
      thickness: width,
      color,
    });
  }

  rect(x: number, yTop: number, w: number, h: number, borderColor: RGB, borderWidth: number): void {
    this.page.drawRectangle({
      x,
      y: this.H - yTop - h,
      width: w,
      height: h,
      borderColor,
      borderWidth,
    });
  }

  fillRect(x: number, yTop: number, w: number, h: number, color: RGB): void {
    this.page.drawRectangle({ x, y: this.H - yTop - h, width: w, height: h, color });
  }

  roundedRect(
    x: number,
    yTop: number,
    w: number,
    h: number,
    r: number,
    opts: { borderColor?: RGB; borderWidth?: number; fill?: RGB },
  ): void {
    const yb = this.H - yTop - h;
    const rr = Math.min(r, w / 2, h / 2);
    const p =
      `M ${x + rr},${yb} ` +
      `H ${x + w - rr} A ${rr},${rr} 0 0 1 ${x + w},${yb + rr} ` +
      `V ${yb + h - rr} A ${rr},${rr} 0 0 1 ${x + w - rr},${yb + h} ` +
      `H ${x + rr} A ${rr},${rr} 0 0 1 ${x},${yb + h - rr} ` +
      `V ${yb + rr} A ${rr},${rr} 0 0 1 ${x + rr},${yb} Z`;
    this.page.drawSvgPath(p, {
      ...(opts.fill ? { color: opts.fill } : {}),
      ...(opts.borderColor ? { borderColor: opts.borderColor, borderWidth: opts.borderWidth ?? 1 } : {}),
    });
  }

  /** PNG data-URL → bytes (null se inválido/grande). Espelha drawSignature do pdfkit. */
  static imageBytes(dataUrl: string | null | undefined, maxBytes = 700000): Uint8Array | null {
    if (!dataUrl) return null;
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
    if (!m) return null;
    try {
      const bytes = base64ToBytes(m[1]);
      if (bytes.length === 0 || bytes.length > maxBytes) return null;
      return bytes;
    } catch {
      return null;
    }
  }

  /** Desenha PNG contido na caixa (x, yTop, w, h), âncora superior-esquerda. Retorna false se inválido. */
  async drawImage(
    bytes: Uint8Array | null,
    x: number,
    yTop: number,
    w: number,
    h: number,
  ): Promise<boolean> {
    if (!bytes) return false;
    try {
      const img = await this.doc.embedPng(bytes);
      const iw = img.width;
      const ih = img.height;
      if (!iw || !ih) return false;
      const s = Math.min(w / iw, h / ih);
      const dw = iw * s;
      const dh = ih * s;
      this.page.drawImage(img, { x, y: this.H - yTop - dh, width: dw, height: dh });
      return true;
    } catch {
      return false;
    }
  }

  async save(): Promise<Uint8Array> {
    return this.doc.save();
  }
}
