import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import SignaturePadLib from 'signature_pad';
import { Eraser } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Label } from '../../../components/ui/form-field';

export interface SignaturePadHandle {
  isEmpty: () => boolean;
  clear: () => void;
  /** PNG data-URL ou null quando vazio. */
  toDataURL: () => string | null;
}

interface SignaturePadProps {
  label?: string;
  hint?: string;
  error?: string | null;
  height?: number;
  onChange?: (empty: boolean) => void;
}

const PAD_HEIGHT = 180;

export const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(function SignaturePad(
  {
    label = 'Assinatura do leitor',
    hint = 'Assine com mouse, dedo ou caneta. Use Limpar para refazer.',
    error,
    height = PAD_HEIGHT,
    onChange,
  },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePadLib | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const heightRef = useRef(height);
  heightRef.current = height;
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const pad = new SignaturePadLib(canvas, { penColor: '#1A1A1A', backgroundColor: '#FFFFFF' });
    padRef.current = pad;
    const sync = () => {
      const e = pad.isEmpty();
      setEmpty(e);
      onChangeRef.current?.(e);
    };
    const resize = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const nextWidth = Math.max(1, Math.floor(wrap.clientWidth * ratio));
      const nextHeight = Math.floor(heightRef.current * ratio);
      // Redimensionar o canvas apaga o traço (o bitmap é perdido ao mudar
      // width/height). Só redimensiona quando o tamanho realmente mudou — antes,
      // qualquer `resize` da janela (inclusive recalculo de layout do navegador)
      // destruía a assinatura que o usuário estava fazendo.
      if (canvas.width === nextWidth && canvas.height === nextHeight) return;
      canvas.width = nextWidth;
      canvas.height = nextHeight;
      canvas.getContext('2d')?.scale(ratio, ratio);
      pad.clear();
      sync();
    };
    resize();
    pad.addEventListener('endStroke', sync);
    let timer = 0;
    const onWindowResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(resize, 150);
    };
    window.addEventListener('resize', onWindowResize);
    return () => {
      window.clearTimeout(timer);
      pad.removeEventListener('endStroke', sync);
      window.removeEventListener('resize', onWindowResize);
      padRef.current = null;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    isEmpty: () => padRef.current?.isEmpty() ?? true,
    clear: () => {
      padRef.current?.clear();
      setEmpty(true);
      onChangeRef.current?.(true);
    },
    toDataURL: () => {
      const pad = padRef.current;
      if (!pad || pad.isEmpty()) return null;
      return pad.toDataURL('image/png');
    },
  }));

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <Label>{label} *</Label>
        <Button type="button" variant="ghost" size="sm" disabled={empty} onClick={() => {
          padRef.current?.clear();
          setEmpty(true);
          onChangeRef.current?.(true);
        }}>
          <Eraser className="size-3.5" /> Limpar
        </Button>
      </div>
      <div ref={wrapRef} className="overflow-hidden rounded-card bg-white hairline">
        <canvas
          ref={canvasRef}
          style={{ height }}
          className="block w-full touch-none cursor-crosshair"
        />
      </div>
      <p className={`mt-1 text-[12px] ${error ? 'font-semibold text-destructive' : 'text-muted'}`}>
        {error ?? hint}
      </p>
    </div>
  );
});
