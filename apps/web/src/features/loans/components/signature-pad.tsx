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
      canvas.width = Math.max(1, Math.floor(wrap.clientWidth * ratio));
      canvas.height = Math.floor(heightRef.current * ratio);
      canvas.getContext('2d')?.scale(ratio, ratio);
      pad.clear();
      sync();
    };
    resize();
    pad.addEventListener('endStroke', sync);
    window.addEventListener('resize', resize);
    return () => {
      pad.removeEventListener('endStroke', sync);
      window.removeEventListener('resize', resize);
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
