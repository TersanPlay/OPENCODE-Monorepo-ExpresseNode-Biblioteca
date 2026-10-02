import { useEffect, useMemo, useState } from 'react';
import { FileDown, Search, Tag } from 'lucide-react';
import { booksApi } from '../../books/api';
import { labelsApi } from '../api';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { EmptyState } from '../../../components/ui/empty-state';
import { Input } from '../../../components/ui/input';
import { PageHeader } from '../../../components/ui/page-header';
import { Skeleton } from '../../../components/ui/skeleton';
import { useDebounce } from '../../hooks/use-debounce';
import { useApiToast } from '../../toast/toast-provider';
import { apiErrorMessage } from '../../../lib/errors';
import type { Book } from '../../../types/api';

const LABEL_W_MM = 140;
const LABEL_H_MM = 50;

function LabelPreview({ book, exemplar }: { book: Book; exemplar: number }) {
  return (
    <div
      className="relative flex bg-white text-ink shadow-sm"
      style={{ width: `${LABEL_W_MM}mm`, height: `${LABEL_H_MM}mm`, border: '1.2px solid #1A1A1A' }}
    >
      <div
        className="flex flex-col gap-[1.4mm] pt-[4.6mm] pl-[3.2mm] text-[9pt] text-[#111827]"
        style={{ width: '51.5mm', borderRight: '0.7px solid #D1D5DB' }}
      >
        {book.cdd && <div>{book.cdd}</div>}
        {book.cutter && <div>{book.cutter}</div>}
        {(book.isbn13 || book.isbn10) && <div>{book.isbn13 || book.isbn10}</div>}
        <div>EX. {exemplar}</div>
        {book.publicationYear != null && <div>{book.publicationYear}</div>}
      </div>
      <div className="flex-1 pl-[4.2mm] pt-[9mm]">
        <div className="font-bold text-[13.5pt] leading-tight text-[#111827]">
          Câmara Municipal de Parauapebas
        </div>
        <div className="mt-[2mm] text-[9.5pt] text-[#374151]">
          Memorial e Biblioteca Legislativa Sônia Côrtes
        </div>
        <div className="mt-[1.6mm] text-[7.5pt] text-[#6B7280]">
          DTI - Departamento de Tecnologia da Informação
        </div>
      </div>
      <div className="absolute bottom-[3.9mm] right-[3.2mm] text-[6.8pt] text-[#6B7280]">
        @ Copyright Legislivros
      </div>
    </div>
  );
}

export function LabelsPage() {
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 350);
  const [results, setResults] = useState<Book[]>([]);
  const [searching, setSearching] = useState(false);
  const [book, setBook] = useState<Book | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [generating, setGenerating] = useState(false);
  const { toast } = useApiToast();

  const copies = useMemo(() => Math.max(book?.availableCopies ?? 1, 1), [book]);

  useEffect(() => {
    const term = debounced.trim();
    if (!term) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    booksApi
      .list({ search: term, pageSize: 8 })
      .then((r) => {
        if (!cancelled) setResults(r.items);
      })
      .catch((err) => {
        if (!cancelled) toast.error('Não foi possível buscar livros', apiErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const selectBook = async (b: Book) => {
    try {
      const full = await booksApi.get(b.id);
      const n = Math.max(full.availableCopies ?? 1, 1);
      setBook(full);
      setSelected(new Set(Array.from({ length: n }, (_, i) => i + 1)));
    } catch (err) {
      toast.error('Não foi possível carregar o livro', apiErrorMessage(err));
    }
  };

  const toggle = (n: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  };

  const previewExemplar = selected.size > 0 ? Math.min(...selected) : 1;

  const generate = async () => {
    if (!book || selected.size === 0) return;
    setGenerating(true);
    try {
      await labelsApi.generatePdf(book.id, [...selected].sort((a, b) => a - b));
      toast.success('Etiquetas geradas', `${selected.size} etiqueta(s) em PDF.`);
    } catch (err) {
      toast.error('Não foi possível gerar as etiquetas', apiErrorMessage(err));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Etiquetas"
        description="Gere etiquetas de 140 × 50 mm para os exemplares do acervo."
      />

      <Card>
        <CardHeader>
          <CardTitle>Selecionar livro</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por título, ISBN, editora ou autor"
              className="pl-9"
              aria-label="Buscar livro"
            />
          </div>
          {searching && <Skeleton className="h-9 w-full" />}
          {!searching && debounced.trim() && results.length === 0 && (
            <EmptyState title="Nenhum livro encontrado" description="Tente outro termo de busca." />
          )}
          {results.length > 0 && (
            <ul className="divide-y divide-hairline rounded-md border border-hairline">
              {results.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => selectBook(b)}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-canvas ${
                      book?.id === b.id ? 'bg-canvas font-medium' : ''
                    }`}
                  >
                    <span className="truncate">{b.title}</span>
                    <span className="ml-3 shrink-0 text-xs text-muted">Cód. {b.id}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {book && (
        <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Exemplares</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-5">
              <p className="text-[13px] text-muted">
                {copies} cópia(s) cadastradas para <span className="text-ink">{book.title}</span>.
                Marque quais etiquetas gerar.
              </p>
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => setSelected(new Set(Array.from({ length: copies }, (_, i) => i + 1)))}
                >
                  Selecionar todos
                </button>
                <button
                  type="button"
                  className="text-xs text-muted hover:underline"
                  onClick={() => setSelected(new Set())}
                >
                  Limpar
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {Array.from({ length: copies }, (_, i) => i + 1).map((n) => (
                  <label
                    key={n}
                    className={`flex cursor-pointer items-center gap-2 rounded-md border border-hairline px-2 py-1.5 text-sm ${
                      selected.has(n) ? 'bg-canvas' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(n)}
                      onChange={() => toggle(n)}
                      aria-label={`Selecionar EX. ${n}`}
                      className="size-4 accent-primary"
                    />
                    EX. {n}
                  </label>
                ))}
              </div>
              <Button onClick={generate} disabled={generating || selected.size === 0} className="w-full">
                <FileDown className="size-4" />
                {generating ? 'Gerando...' : `Gerar PDF (${selected.size})`}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Tag className="size-4" /> Prévia da etiqueta
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-auto p-5">
              <div className="inline-block">
                <LabelPreview book={book} exemplar={previewExemplar} />
              </div>
              <p className="mt-3 text-[12px] text-muted">
                Prévia no tamanho real (140 × 50 mm). Mostrando EX. {previewExemplar} — a prévia
                acompanha a primeira etiqueta selecionada.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {!book && (
        <EmptyState
          title="Nenhum livro selecionado"
          description="Busque e selecione um livro acima para montar a etiqueta."
        />
      )}
    </div>
  );
}
