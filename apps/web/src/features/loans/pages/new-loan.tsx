import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, Plus, Search, UserRound, X } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
import { EmptyState } from '../../../components/ui/empty-state';
import { Label } from '../../../components/ui/form-field';
import { Input } from '../../../components/ui/input';
import { Skeleton } from '../../../components/ui/skeleton';
import { ReaderStatusBadge } from '../../../components/ui/status-badge';
import { TD, TBody, TR, Table } from '../../../components/ui/table';
import { BookCover } from '../../../components/layout/book-cover';
import { Badge } from '../../../components/ui/badge';
import { booksApi, loansApi, readersApi, settingsApi } from '../../api';
import { SignatureField, type SignatureFieldHandle } from '../components/signature-field';
import { useDebounce } from '../../hooks/use-debounce';
import { useApiToast } from '../../toast/toast-provider';
import { apiErrorMessage } from '../../../lib/errors';
import { formatCPF, addDaysInput, todayInput } from '../../../lib/format';
import type { Book, LibrarySettings, Paginated, Reader } from '../../../types/api';

const schema = z.object({
  dueDate: z.string().min(1, 'Informe a data de vencimento'),
  notes: z.string(),
});

export function NewLoanPage() {
  const navigate = useNavigate();
  const { toast } = useApiToast();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [readerQuery, setReaderQuery] = useState('');
  const [readerResult, setReaderResult] = useState<Paginated<Reader> | null>(null);
  const [readerLoading, setReaderLoading] = useState(false);
  const [reader, setReader] = useState<Reader | null>(null);

  const [bookQuery, setBookQuery] = useState('');
  const [bookResult, setBookResult] = useState<Paginated<Book> | null>(null);
  const [bookLoading, setBookLoading] = useState(false);
  const [books, setBooks] = useState<Book[]>([]);
  const [bookLimit, setBookLimit] = useState<number | null>(null);

  const readerDebounced = useDebounce(readerQuery, 400);
  const bookDebounced = useDebounce(bookQuery, 400);
  const [busy, setBusy] = useState(false);
  const sigFieldRef = useRef<SignatureFieldHandle>(null);
  const [sigValid, setSigValid] = useState(false);

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { dueDate: addDaysInput(14), notes: '' },
  });
  const dueDatePreview = watch('dueDate');

  const searchReaders = async (q: string, signal?: AbortSignal) => {
    if (!q.trim()) {
      setReaderResult(null);
      return;
    }
    setReaderLoading(true);
    try {
      setReaderResult(await readersApi.list({ search: q, pageSize: 8 }, signal));
    } catch {
      if (!signal?.aborted) setReaderResult(null);
    } finally {
      if (!signal?.aborted) setReaderLoading(false);
    }
  };

  const searchBooks = async (q: string, signal?: AbortSignal) => {
    if (!q.trim()) {
      setBookResult(null);
      return;
    }
    setBookLoading(true);
    try {
      setBookResult(await booksApi.list({ search: q, pageSize: 8, includeArchived: 1 }, signal));
    } catch {
      if (!signal?.aborted) setBookResult(null);
    } finally {
      if (!signal?.aborted) setBookLoading(false);
    }
  };

  // Uma requisição por pausa de digitação, e a anterior é cancelada de verdade:
  // sem isso, a resposta de "dom" podia chegar depois da de "dom casmurro".
  useEffect(() => {
    if (!readerDebounced.trim()) return;
    const controller = new AbortController();
    searchReaders(readerDebounced, controller.signal);
    return () => controller.abort();
  }, [readerDebounced]);

  useEffect(() => {
    if (!bookDebounced.trim()) return;
    const controller = new AbortController();
    searchBooks(bookDebounced, controller.signal);
    return () => controller.abort();
  }, [bookDebounced]);

  useEffect(() => {
    settingsApi
      .get()
      .then((s: LibrarySettings) => setBookLimit(s.loanLimit))
      .catch(() => setBookLimit(null));
  }, []);

  const toggleBook = (b: Book) => {
    setBooks((prev) => (prev.some((x) => x.id === b.id) ? prev.filter((x) => x.id !== b.id) : [...prev, b]));
  };

  const availableForReader = reader && bookLimit !== null ? Math.max(0, bookLimit - (reader.activeLoans ?? 0)) : null;

  const submit = async (v: { dueDate: string; notes: string }) => {
    if (!reader || books.length === 0) return;
    const sig = sigFieldRef.current?.resolve();
    if (!sig) return;
    setBusy(true);
    try {
      const res = await loansApi.createBatch({
        readerId: reader.id,
        bookIds: books.map((b) => b.id),
        dueDate: v.dueDate || undefined,
        notes: v.notes || undefined,
        ...sig,
      });
      toast.success(
        res.count > 1 ? `${res.count} empréstimos registrados` : 'Empréstimo registrado',
        res.count > 1 ? `Para ${reader.name}` : `${res.items[0]?.book?.title} → ${reader.name}`,
      );
      navigate('/admin/emprestimos');
    } catch (err) {
      toast.error('Não foi possível registrar', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const resetAll = () => {
    setStep(1);
    setReader(null);
    setBooks([]);
    setReaderQuery('');
    setBookQuery('');
    sigFieldRef.current?.reset();
    setSigValid(false);
    reset({ dueDate: addDaysInput(14), notes: '' });
  };

  const formatPreviewDate = (iso: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Novo empréstimo</h1>
          <p className="mt-1 text-[13.5px] text-muted">Balcão de atendimento — 3 passos.</p>
        </div>
        <Button variant="secondary" onClick={() => navigate(-1)}>
          <ArrowLeft className="size-4" /> Voltar
        </Button>
      </div>

      <div className="flex items-center gap-2">
        {[
          { n: 1, label: 'Leitor' },
          { n: 2, label: 'Livro' },
          { n: 3, label: 'Confirmar' },
        ].map((s) => (
          <div key={s.n} className="flex flex-1 items-center gap-2">
            <div
              className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[12px] font-extrabold transition-colors duration-200 ${
                step >= s.n ? 'bg-primary text-white' : step > s.n ? 'bg-success-soft text-success' : 'bg-canvas text-muted'
              }`}
            >
              {step > s.n ? <CheckCircle2 className="size-4" /> : s.n}
            </div>
            <span className={`hidden text-[12.5px] font-semibold sm:block ${step >= s.n ? 'text-ink' : 'text-muted'}`}>
              {s.label}
            </span>
            {s.n < 3 && <div className="h-px flex-1 bg-black/10" />}
          </div>
        ))}
      </div>

      {step === 1 && (
        <Card>
          <CardContent className="p-5">
            <Label>Buscar leitor</Label>
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input
                value={readerQuery}
                onChange={(e) => setReaderQuery(e.target.value)}
                placeholder="Nome, CPF ou e-mail..."
                className="pl-10"
                autoFocus
              />
            </div>

            {readerLoading ? (
              <div className="mt-4 space-y-2">
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </div>
            ) : readerResult ? (
              <Table className="mt-4">
                <TBody>
                  {readerResult.items.map((r) => {
                    const canSelect = r.status === 'ACTIVE';
                    return (
                      <TR
                        key={r.id}
                        className={canSelect ? 'cursor-pointer' : undefined}
                        onClick={() => { if (canSelect) { setReader(r); setStep(2); } }}
                      >
                        <TD className="font-semibold text-ink">{r.name}</TD>
                        <TD className="font-mono text-[12px] text-muted">{formatCPF(r.cpf)}</TD>
                        <TD><ReaderStatusBadge status={r.status} /></TD>
                        <TD className="text-right">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={!canSelect}
                            title={canSelect ? undefined : 'Leitor bloqueado ou inativo não pode realizar empréstimos'}
                          >
                            {canSelect ? 'Selecionar' : 'Indisponível'} {canSelect && <ArrowRight className="size-3.5" />}
                          </Button>
                        </TD>
                      </TR>
                    );
                  })}
                  {readerResult.items.length === 0 && (
                    <TR>
                      <TD colSpan={4}>
                        <EmptyState compact title="Nenhum leitor encontrado" />
                      </TD>
                    </TR>
                  )}
                </TBody>
              </Table>
            ) : null}
          </CardContent>
        </Card>
      )}

      {step === 2 && reader && (
        <Card>
          <CardContent className="p-5">
            <div className="mb-4 flex items-center justify-between rounded-card bg-surfaceBlue2 px-4 py-3">
              <span className="flex items-center gap-2.5">
                <UserRound className="size-4 text-primary" />
                <span className="text-[13.5px] font-bold text-ink">{reader.name}</span>
                <span className="font-mono text-[12px] text-muted">{formatCPF(reader.cpf)}</span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => { setReader(null); setBooks([]); setStep(1); }}>
                Trocar
              </Button>
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Label>Buscar livro disponível</Label>
              <span className="ml-auto rounded-full bg-surface px-3 py-1 text-[12px] font-bold text-ink hairline">
                {availableForReader === null
                  ? 'Limite de empréstimos: —'
                  : `${books.length} de ${availableForReader} disponíveis`}
              </span>
            </div>
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input
                value={bookQuery}
                onChange={(e) => setBookQuery(e.target.value)}
                placeholder="Título, autor ou ISBN..."
                className="pl-10"
                autoFocus
              />
            </div>

            {bookLoading ? (
              <div className="mt-4 space-y-2">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            ) : bookResult ? (
              <div className="mt-4 space-y-2">
                {bookResult.items.map((b) => {
                  const selected = books.some((x) => x.id === b.id);
                  const atLimit = availableForReader !== null && books.length >= availableForReader && !selected;
                  return (
                    <div
                      key={b.id}
                      className={`flex flex-wrap items-center gap-3 rounded-card p-3 hairline ${
                        selected ? 'bg-primary-soft ring-1 ring-primary' : 'bg-surface'
                      }`}
                    >
                      <BookCover src={b.coverUrl} title={b.title} className="h-14 w-10 shrink-0 rounded-small" />
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-1 text-[13.5px] font-bold text-ink">{b.title}</p>
                        <p className="text-[12px] text-muted">
                          {b.authors.map((a) => a.author.name).join(', ')}
                        </p>
                        <p className="mt-0.5">
                          {selected ? (
                            <Badge variant="primary" dot>Selecionado</Badge>
                          ) : b.isAvailable ? (
                            <Badge variant="success" dot>Disponível</Badge>
                          ) : (
                            <Badge variant="warning" dot>Indisponível</Badge>
                          )}
                        </p>
                      </div>
                      {selected ? (
                        <Button variant="ghost" size="sm" onClick={() => toggleBook(b)}>
                          <X className="size-3.5" /> Remover
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!b.isAvailable || atLimit}
                          title={atLimit ? 'Limite de empréstimos deste leitor atingido' : undefined}
                          onClick={() => toggleBook(b)}
                        >
                          <Plus className="size-3.5" /> Adicionar
                        </Button>
                      )}
                    </div>
                  );
                })}
                {bookResult.items.every((b) => !b.isAvailable) && (
                  <EmptyState compact title="Nenhum livro disponível" description="Todos os resultados estão emprestados ou reservados." />
                )}
              </div>
            ) : null}

            <div className="mt-5 flex items-center justify-between">
              <Button variant="ghost" onClick={() => { setBooks([]); setStep(1); }}>
                <ArrowLeft className="size-4" /> Voltar
              </Button>
              <Button disabled={books.length === 0} onClick={() => setStep(3)}>
                Continuar {books.length > 0 && `(${books.length})`} <ArrowRight className="size-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && reader && books.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <div className="mb-5 rounded-card bg-surfaceBlue2 p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted">
                Pré-visualização do Termo de Empréstimo
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Leitor</p>
                  <p className="text-[13.5px] font-bold text-ink">{reader.name}</p>
                  <p className="font-mono text-[12px] text-muted">LTR-{String(reader.id).padStart(6, '0')}</p>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Prazos</p>
                  <p className="text-[13px] text-ink">Empréstimo: {new Date().toLocaleDateString('pt-BR')}</p>
                  <p className="text-[13px] text-ink">Devolução prevista: {formatPreviewDate(dueDatePreview)}</p>
                </div>
              </div>
              <div className="mt-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted">
                  Material bibliográfico ({books.length})
                </p>
                <ul className="mt-1 space-y-1.5">
                  {books.map((b) => (
                    <li key={b.id} className="flex items-center gap-2">
                      <BookOpen className="size-3.5 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-1 block text-[13px] font-semibold text-ink">{b.title}</span>
                        <span className="block text-[12px] text-muted">
                          {b.authors.map((a) => a.author.name).join(', ')}
                          {(b.isbn13 || b.isbn10) && ` — ISBN ${b.isbn13 || b.isbn10}`}
                        </span>
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="ml-auto shrink-0 text-muted hover:text-destructive"
                        onClick={() => {
                          setBooks((prev) => prev.filter((x) => x.id !== b.id));
                          sigFieldRef.current?.reset();
                        }}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="mt-3 text-[12px] italic text-muted">
                Declaro que o material acima foi recebido pelo leitor na data indicada,
                comprometendo-se à devolução no prazo estabelecido.
              </p>
            </div>

            <form onSubmit={handleSubmit(submit)} className="space-y-4">
              <div>
                <Label>Data de vencimento</Label>
                <Input type="date" min={todayInput()} error={errors.dueDate?.message} {...register('dueDate')} />
              </div>
              <div>
                <Label>Observações</Label>
                <Input placeholder="Opcional..." {...register('notes')} />
              </div>
              <SignatureField
                ref={sigFieldRef}
                savedSignature={reader.signature}
                onValidityChange={setSigValid}
              />
              <div className="flex items-center justify-between">
                <Button type="button" variant="ghost" onClick={() => {
                  sigFieldRef.current?.reset();
                  setStep(2);
                }}>
                  <ArrowLeft className="size-4" /> Voltar
                </Button>
                <div className="flex gap-2">
                  <Button type="button" variant="secondary" onClick={resetAll}>Cancelar</Button>
                  <Button type="submit" loading={busy} disabled={!sigValid}>
                    <BookOpen className="size-4" /> Confirmar {books.length} {books.length === 1 ? 'empréstimo' : 'empréstimos'}
                  </Button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}