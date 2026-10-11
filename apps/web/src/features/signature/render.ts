import type { SelectOption } from '@library/ui';

export const SIGNATURE_FONTS: SelectOption[] = [
  { value: 'Great Vibes', label: 'Great Vibes' },
  { value: 'Dancing Script', label: 'Dancing Script' },
  { value: 'Caveat', label: 'Caveat' },
  { value: 'Homemade Apple', label: 'Homemade Apple' },
];

const INK = '#1A1A1A';
const CANVAS_SCALE = 2;
/** Piso da busca: proporção da LARGURA do canvas (assinatura 520 → 104; rubrica 160 → 32). */
const MIN_FONT_RATIO = 0.2;
/** Guarda absoluta: proporção da ALTURA do canvas — nunca corta a tinta nem fica minúsculo. */
const MIN_SHRINK_RATIO = 0.35;
const MAX_FONT_SIZE = 240;
/** Margem pequena nas bordas: o texto aproveita todo o resto do espaço. */
const PAD_X_RATIO = 0.03;
const PAD_Y_RATIO = 0.06;

function makeCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width * CANVAS_SCALE;
  canvas.height = height * CANVAS_SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponível');
  ctx.scale(CANVAS_SCALE, CANVAS_SCALE);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  return { canvas, ctx };
}

async function ensureFont(fontFamily: string, sizePx: number): Promise<void> {
  try {
    await document.fonts.load(`${sizePx}px "${fontFamily}"`);
  } catch {
    // offline/sem rede: cai na fonte fallback do navegador
  }
}

/** Renderiza texto (assinatura ou rubrica) em fonte manuscrita → PNG data-URL. */
export async function renderTextSignature(
  text: string,
  fontFamily: string,
  opts: { width?: number; height?: number; fontSize?: number } = {},
): Promise<string> {
  const width = opts.width ?? 520;
  const height = opts.height ?? 160;
  const { canvas, ctx } = makeCanvas(width, height);
  await ensureFont(fontFamily, MAX_FONT_SIZE);

  // Alinhamento ANTES de medir: actualBoundingBoxLeft/Right são relativos ao
  // ponto de alinhamento. Medir com 'start' (padrão) e desenhar com 'center'
  // conta a largura em dobro e deixa o texto espremido no meio do canvas.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // Margem pequena: o texto usa todo o espaço disponível sem tocar as extremidades.
  const padX = width * PAD_X_RATIO;
  const padY = height * PAD_Y_RATIO;
  const halfLimit = width / 2 - padX;
  const heightLimit = height - padY * 2;

  const ink = (m: TextMetrics, size: number) => ({
    half: Math.max(m.actualBoundingBoxLeft ?? 0, m.actualBoundingBoxRight ?? m.width / 2),
    height:
      (m.actualBoundingBoxAscent ?? size * 0.8) + (m.actualBoundingBoxDescent ?? size * 0.3),
  });

  const fitsAt = (size: number): boolean => {
    ctx.font = `${size}px "${fontFamily}", cursive`;
    const k = ink(ctx.measureText(text), size);
    return k.half <= halfLimit && k.height <= heightLimit;
  };

  // Piso proporcional à LARGURA do canvas: o texto fica grande e, com a
  // compressão final, ocupa TODA a largura (sem laterais vazias).
  const minFontSize = Math.max(32, Math.round(width * MIN_FONT_RATIO));

  // Busca binária do MAIOR tamanho que cabe na caixa (altura) acima do piso.
  const maxSize = Math.max(opts.fontSize ?? MAX_FONT_SIZE, minFontSize);
  let low = 0;
  let high = Math.floor((maxSize - minFontSize) / 2);
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fitsAt(minFontSize + mid * 2)) low = mid;
    else high = mid - 1;
  }
  let fontSize = minFontSize + low * 2;
  // Piso absoluto proporcional à ALTURA do canvas (assinatura 160 → 56; rubrica 90 → 32).
  const absoluteMin = Math.round(height * MIN_SHRINK_RATIO);
  ctx.font = `${fontSize}px "${fontFamily}", cursive`;
  // Piso não cabe na altura (ex.: rubrica com fonte alta)? Encolhe só até o
  // piso proporcional — nunca para um tamanho minúsculo e nunca corta a tinta.
  while (fontSize > absoluteMin && ink(ctx.measureText(text), fontSize).height > heightLimit) {
    fontSize -= 2;
    ctx.font = `${fontSize}px "${fontFamily}", cursive`;
  }
  const m = ctx.measureText(text);

  ctx.fillStyle = INK;
  const ascent = m.actualBoundingBoxAscent ?? fontSize * 0.8;
  const descent = m.actualBoundingBoxDescent ?? fontSize * 0.3;
  // Baseline que centraliza a tinta verticalmente (ascendentes/descendentes das fontes manuscritas).
  const baselineY = height / 2 + (ascent - descent) / 2;
  // Caso extremo (texto longo demais até no tamanho mínimo)? Comprime só o eixo X — nunca corta.
  const { half } = ink(m, fontSize);
  const squeeze = half > halfLimit && half > 0 ? halfLimit / half : 1;
  ctx.save();
  if (squeeze < 1) {
    ctx.translate(width / 2, 0);
    ctx.scale(squeeze, 1);
    ctx.translate(-width / 2, 0);
  }
  ctx.fillText(text, width / 2, baselineY);
  ctx.restore();
  return canvas.toDataURL('image/png');
}

/** Converte arquivo de imagem (upload) em PNG data-URL com fundo branco. */
export function imageFileToPng(file: File, opts: { width?: number; height?: number } = {}): Promise<string> {
  const width = opts.width ?? 520;
  const height = opts.height ?? 160;
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Selecione um arquivo de imagem'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { canvas, ctx } = makeCanvas(width, height);
      const scale = Math.min((width * 0.9) / img.width, (height * 0.9) / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível ler a imagem'));
    };
    img.src = url;
  });
}
