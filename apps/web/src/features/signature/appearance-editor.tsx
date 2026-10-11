import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ImageUp, PenLine, Type, Upload } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Label } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { SignaturePad, type SignaturePadHandle } from '../loans/components/signature-pad';
import {
  SIGNATURE_FONTS,
  imageFileToPng,
  renderTextSignature,
} from './render';
import type { SignatureType } from '../../types/api';

export interface AppearanceValue {
  signature: string;
  signatureType: SignatureType;
  signatureText: string | null;
  rubricText: string | null;
  rubricImage: string | null;
  fontFamily: string | null;
}

export interface AppearanceEditorHandle {
  /** PNG final + metadados, ou null quando inválido (erro visível). */
  resolve: () => Promise<AppearanceValue | null>;
  reset: () => void;
}

interface AppearanceEditorProps {
  initial?: {
    signature?: string | null;
    signatureType?: SignatureType | null;
    signatureText?: string | null;
    rubricText?: string | null;
    rubricImage?: string | null;
    fontFamily?: string | null;
  } | null;
}

const TABS: { value: SignatureType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'TEXT', label: 'Texto', icon: Type },
  { value: 'DRAW', label: 'Desenhar', icon: PenLine },
  { value: 'IMAGE', label: 'Imagem', icon: ImageUp },
];

const TAB_VALUES: SignatureType[] = TABS.map((t) => t.value);

export const AppearanceEditor = forwardRef<AppearanceEditorHandle, AppearanceEditorProps>(
  function AppearanceEditor({ initial }, ref) {
    const initialRef = useRef(initial);
    const [tab, setTab] = useState<SignatureType>(
      TAB_VALUES.includes(initial?.signatureType as SignatureType)
        ? (initial?.signatureType as SignatureType)
        : 'TEXT',
    );
    const [text, setText] = useState(initial?.signatureText ?? '');
    const [font, setFont] = useState(initial?.fontFamily ?? SIGNATURE_FONTS[0].value);
    const [rubricText, setRubricText] = useState(initial?.rubricText ?? '');
    const [imageData, setImageData] = useState<string | null>(
      initial?.signatureType === 'IMAGE' ? (initial.signature ?? null) : null,
    );
    const [textPreview, setTextPreview] = useState<string | null>(null);
    const [rubricPreview, setRubricPreview] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const drawRef = useRef<SignaturePadHandle>(null);
    const rubricPadRef = useRef<SignaturePadHandle>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    // Cancelar sempre volta ao último estado salvo (não ao estado do mount).
    useEffect(() => {
      initialRef.current = initial;
    }, [initial]);

    // Assinatura removida externamente (exclusão) limpa o editor automaticamente.
    useEffect(() => {
      if (initial?.signature) return;
      setTab('TEXT');
      setText('');
      setFont(SIGNATURE_FONTS[0].value);
      setRubricText('');
      setImageData(null);
      setError(null);
      drawRef.current?.clear();
      rubricPadRef.current?.clear();
    }, [initial?.signature]);

    useEffect(() => {
      let cancelled = false;
      if (tab === 'TEXT') {
        const t = text.trim();
        if (t) {
          renderTextSignature(t, font)
            .then((u) => !cancelled && setTextPreview(u))
            .catch(() => undefined);
        } else {
          setTextPreview(null);
        }
        const rt = rubricText.trim();
        if (rt) {
          renderTextSignature(rt, font, { width: 160, height: 90 })
            .then((u) => !cancelled && setRubricPreview(u))
            .catch(() => undefined);
        } else {
          setRubricPreview(null);
        }
      } else {
        setTextPreview(null);
        setRubricPreview(null);
      }
      return () => {
        cancelled = true;
      };
    }, [tab, text, font, rubricText]);

    const onFile = async (file: File | undefined) => {
      if (!file) return;
      try {
        setImageData(await imageFileToPng(file));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Não foi possível ler a imagem');
      }
    };

    useImperativeHandle(ref, () => ({
      async resolve() {
        if (tab === 'TEXT') {
          const t = text.trim();
          if (!t) {
            setError('Digite o texto da assinatura.');
            return null;
          }
          const signature = await renderTextSignature(t, font);
          const rt = rubricText.trim();
          const rubricImage = rt
            ? await renderTextSignature(rt, font, { width: 160, height: 90 })
            : null;
          setError(null);
          return { signature, signatureType: 'TEXT' as const, signatureText: t, rubricText: rt || null, rubricImage, fontFamily: font };
        }
        if (tab === 'DRAW') {
          const signature = drawRef.current?.toDataURL();
          if (!signature) {
            setError('Desenhe a assinatura para continuar.');
            return null;
          }
          const rubricImage = rubricPadRef.current?.toDataURL() ?? null;
          setError(null);
          return { signature, signatureType: 'DRAW' as const, signatureText: null, rubricText: null, rubricImage, fontFamily: null };
        }
        if (tab === 'IMAGE') {
          if (!imageData) {
            setError('Selecione uma imagem de assinatura.');
            return null;
          }
          const rt = rubricText.trim();
          const rubricImage = rt
            ? await renderTextSignature(rt, font, { width: 160, height: 90 })
            : null;
          setError(null);
          return { signature: imageData, signatureType: 'IMAGE' as const, signatureText: null, rubricText: rt || null, rubricImage, fontFamily: rt ? font : null };
        }
        return null;
      },
      reset() {
        const i = initialRef.current;
        setTab(TAB_VALUES.includes(i?.signatureType as SignatureType) ? (i?.signatureType as SignatureType) : 'TEXT');
        setText(i?.signatureText ?? '');
        setFont(i?.fontFamily ?? SIGNATURE_FONTS[0].value);
        setRubricText(i?.rubricText ?? '');
        setImageData(i?.signatureType === 'IMAGE' ? (i.signature ?? null) : null);
        setError(null);
        drawRef.current?.clear();
        rubricPadRef.current?.clear();
      },
    }));

    return (
      <div className="space-y-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as SignatureType)}>
          <TabsList className="grid w-full grid-cols-3">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="gap-1.5">
                <t.icon className="size-3.5" /> {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="TEXT" className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-[12px] font-bold text-muted">Assinatura</p>
                <div className="flex h-[140px] items-center justify-center overflow-hidden rounded-card bg-white hairline">
                  {textPreview ? (
                    <img src={textPreview} alt="Prévia da assinatura" className="max-h-full object-contain" />
                  ) : (
                    <span className="text-[12px] text-muted">Digite o texto para ver a prévia</span>
                  )}
                </div>
              </div>
              <div>
                <p className="mb-1 text-[12px] font-bold text-muted">Rubrica</p>
                <div className="flex h-[90px] items-center justify-center overflow-hidden rounded-card bg-white hairline">
                  {rubricPreview ? (
                    <img src={rubricPreview} alt="Prévia da rubrica" className="max-h-full object-contain" />
                  ) : (
                    <span className="text-[12px] text-muted">Opcional — iniciais do signatário</span>
                  )}
                </div>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-1">
                <Label htmlFor="sig-text">Texto da assinatura</Label>
                <Input id="sig-text" value={text} maxLength={80} placeholder="Ex.: Ariel J" onChange={(e) => setText(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="sig-rubric">Rubrica</Label>
                <Input id="sig-rubric" value={rubricText} maxLength={10} placeholder="Ex.: AJ" onChange={(e) => setRubricText(e.target.value)} />
              </div>
              <div>
                <Label>Fonte</Label>
                <Select value={font} onValueChange={setFont} options={SIGNATURE_FONTS} />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="DRAW" className="mt-4 space-y-4">
            <SignaturePad
              ref={drawRef}
              label="Assinatura"
              hint="Assine com mouse, dedo ou caneta."
            />
            <div>
              <p className="mb-1 text-[12px] font-bold text-muted">Rubrica (opcional)</p>
              <SignaturePad
                ref={rubricPadRef}
                label="Rubrica"
                hint="Desenhe as iniciais ou deixe em branco."
                height={90}
              />
            </div>
          </TabsContent>

          <TabsContent value="IMAGE" className="mt-4 space-y-4">
            <div className="flex h-[160px] items-center justify-center overflow-hidden rounded-card bg-white hairline">
              {imageData ? (
                <img src={imageData} alt="Assinatura enviada" className="max-h-full object-contain" />
              ) : (
                <span className="text-[12px] text-muted">Nenhuma imagem selecionada</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  void onFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}>
                <Upload className="size-4" /> Selecionar imagem
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="img-rubric">Rubrica</Label>
                <Input id="img-rubric" value={rubricText} maxLength={10} placeholder="Ex.: AJ" onChange={(e) => setRubricText(e.target.value)} />
              </div>
              <div>
                <Label>Fonte da rubrica</Label>
                <Select value={font} onValueChange={setFont} options={SIGNATURE_FONTS} />
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {error && <p className="text-[12.5px] font-semibold text-destructive">{error}</p>}
      </div>
    );
  },
);
