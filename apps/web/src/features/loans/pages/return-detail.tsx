import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Undo2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
import { EmptyState } from '../../../components/ui/empty-state';
import { PageHeader } from '../../../components/ui/page-header';
import { Select } from '../../../components/ui/select';
import { Skeleton } from '../../../components/ui/skeleton';
import { LoanStatusBadge } from '../../../components/ui/status-badge';
import { TD, TH, TBody, THead, TR, Table } from '../../../components/ui/table';
import { loansApi, readersApi } from '../../api';
import { SignatureField, type SignatureFieldHandle } from '../components/signature-field';
import { useAsyncData } from '../../hooks/use-async-data';
import { useApiToast } from '../../toast/toast-provider';
import { apiErrorMessage } from '../../../lib/errors';
import { formatCPF, formatDate } from '../../../lib/format';

export function ReturnDetailPage() {
  const { readerId } = useParams<{ readerId: string }>();
  const navigate = useNavigate();
  const { toast } = useApiToast();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [condition, setCondition] = useState('');
  const [observations, setObservations] = useState('');
  const [busy, setBusy] = useState(false);
  const sigFieldRef = useRef<SignatureFieldHandle>(null);
  const [sigValid, setSigValid] = useState(false);

  const fetcher = () => readersApi.get(Number(readerId));
  const { data, error, loading } = useAsyncData(fetcher, [readerId]);

  const loans = data?.activeLoans ?? [];
  const allSelected = loans.length > 0 && selected.size === loans.length;

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(loans.map((l) => l.id)));
  };

  const confirm = async () => {
    if (selected.size === 0 || !data) return;
    const sig = sigFieldRef.current?.resolve();
    if (!sig) return;
    const ids = [...selected];
    const payload = {
      condition: condition || undefined,
      observations: observations || undefined,
      ...sig,
    };
    setBusy(true);
    try {
      if (ids.length === 1) {
        await loansApi.return(ids[0], payload);
        toast.success('Devolução registrada', data.reader.name);
        await loansApi.openReturnTerm(ids[0]);
      } else {
        const res = await loansApi.returnBatch({ loanIds: ids, ...payload });
        toast.success(`Devolução registrada`, `${res.count} livros de ${data.reader.name}`);
        await loansApi.openBatchReturnTerm(res.group);
      }
      navigate('/admin/devolucoes');
    } catch (err) {
      toast.error('Não foi possível registrar', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <Link
        to="/admin/devolucoes"
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary transition-colors hover:text-primary-dark"
      >
        <ArrowLeft className="size-4" /> Devoluções
      </Link>

      {error || (!loading && !data) ? (
        <Card variant="soft" className="py-12 text-center">
          <p className="text-sm font-semibold text-destructive">{error ?? 'Leitor não encontrado.'}</p>
        </Card>
      ) : loading || !data ? (
        <Card className="p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="mb-3 h-12" />
          ))}
        </Card>
      ) : (
        <>
          <PageHeader
            title={`Devolver — ${data.reader.name}`}
            description={`CPF ${formatCPF(data.reader.cpf)} · ${loans.length} ${loans.length === 1 ? 'livro em aberto' : 'livros em aberto'}`}
          />

          {loans.length === 0 ? (
            <Card variant="soft">
              <EmptyState title="Nada a devolver" description="Este leitor não possui empréstimos abertos." />
            </Card>
          ) : (
            <Card>
              <CardContent className="space-y-4 p-5">
                <Table>
                  <THead>
                    <TR>
                      <TH>
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleAll}
                          aria-label="Selecionar todos"
                          className="size-4 accent-primary"
                        />
                      </TH>
                      <TH>Livro</TH>
                      <TH>Saída</TH>
                      <TH>Vencimento</TH>
                      <TH>Atraso</TH>
                      <TH>Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {loans.map((l) => {
                      const overdue = l.status === 'OVERDUE';
                      const lateDays = overdue
                        ? Math.max(0, Math.floor((new Date().getTime() - new Date(l.dueDate).getTime()) / 86400000))
                        : 0;
                      return (
                        <TR key={l.id} className={overdue ? 'bg-destructive-soft/30' : undefined}>
                          <TD>
                            <input
                              type="checkbox"
                              checked={selected.has(l.id)}
                              onChange={() => toggle(l.id)}
                              aria-label={`Selecionar ${l.book?.title}`}
                              className="size-4 accent-primary"
                            />
                          </TD>
                          <TD className="max-w-60">
                            <span className="block line-clamp-1 font-medium text-ink/85">{l.book?.title}</span>
                            <span className="font-mono text-[11.5px] text-muted">{l.number ?? `#${l.id}`}</span>
                          </TD>
                          <TD className="text-muted">{formatDate(l.loanDate)}</TD>
                          <TD className="text-muted">{formatDate(l.dueDate)}</TD>
                          <TD>
                            {overdue ? (
                              <span className="font-bold text-destructive">{lateDays}d</span>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </TD>
                          <TD><LoanStatusBadge status={l.status} /></TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-ink/70">Condição dos livros</label>
                    <Select
                      value={condition || 'NONE'}
                      onValueChange={(v) => setCondition(v === 'NONE' ? '' : v)}
                      options={[
                        { value: 'NONE', label: 'Não informado' },
                        { value: 'BOM', label: 'Bom estado' },
                        { value: 'REGULAR', label: 'Regular' },
                        { value: 'DANIFICADO', label: 'Danificado' },
                      ]}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-ink/70">Observações</label>
                    <textarea
                      value={observations}
                      onChange={(e) => setObservations(e.target.value)}
                      placeholder="Ex.: capa com amassado, páginas marcadas..."
                      rows={1}
                      maxLength={500}
                      className="w-full rounded-control bg-surface px-2 py-1.5 text-sm text-ink shadow-[inset_0_0_0_1px_rgba(23,26,26,.1)] focus:outline-none focus:shadow-[inset_0_0_0_2px_#087F8C]"
                    />
                  </div>
                </div>

                <SignatureField
                  ref={sigFieldRef}
                  savedSignature={data.reader.signature}
                  onValidityChange={setSigValid}
                />

                <div className="flex items-center justify-between">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={toggleAll}
                  >
                    {allSelected ? 'Desmarcar todos' : 'Selecionar todos'}
                  </Button>
                  <Button loading={busy} disabled={selected.size === 0 || !sigValid} onClick={() => void confirm()}>
                    <Undo2 className="size-4" /> Devolver {selected.size > 0 ? `${selected.size} ${selected.size === 1 ? 'livro' : 'livros'}` : ''}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
