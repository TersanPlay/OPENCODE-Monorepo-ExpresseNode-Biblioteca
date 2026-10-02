import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, Search } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { EmptyState } from '../../../components/ui/empty-state';
import { PageHeader } from '../../../components/ui/page-header';
import { Pagination } from '../../../components/ui/pagination';
import { Skeleton } from '../../../components/ui/skeleton';
import { Badge } from '../../../components/ui/badge';
import { TD, TH, TBody, THead, TR, Table } from '../../../components/ui/table';
import { loansApi } from '../../api';
import { useAsyncData } from '../../hooks/use-async-data';
import { useDebounce } from '../../hooks/use-debounce';
import { formatCPF } from '../../../lib/format';

export function ReturnsPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const page = Number(params.get('page') ?? '1');
  const [input, setInput] = useState(q);
  const debounced = useDebounce(input, 350);

  const fetcher = () =>
    loansApi.pendingReturns({ search: debounced || undefined, page, pageSize: 12 });
  const { data, error, loading } = useAsyncData(fetcher, [debounced, page]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Devoluções"
        description={`${data?.total ?? 0} leitores com empréstimos abertos`}
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Buscar por leitor, CPF ou livro..."
            className="h-10 w-full rounded-control bg-surface pl-10 pr-3 text-sm text-ink shadow-[inset_0_0_0_1px_rgba(23,26,26,.1)] focus:outline-none focus:shadow-[inset_0_0_0_2px_#087F8C]"
          />
        </div>
      </div>

      {error ? (
        <Card variant="soft" className="py-12 text-center">
          <p className="text-sm font-semibold text-destructive">{error}</p>
        </Card>
      ) : loading ? (
        <Card className="p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="mb-3 h-12" />
          ))}
        </Card>
      ) : data && data.items.length === 0 ? (
        <Card variant="soft">
          <EmptyState
            title="Nenhuma devolução pendente"
            description="Nenhum leitor com empréstimos abertos."
          />
        </Card>
      ) : (
        data && (
          <>
            <Card className="overflow-hidden p-0">
              <Table>
                <THead>
                  <TR>
                    <TH>Leitor</TH>
                    <TH>Livros em aberto</TH>
                    <TH>Atrasados</TH>
                    <TH className="text-right">Ações</TH>
                  </TR>
                </THead>
                <TBody>
                  {data.items.map((g) => (
                    <TR key={g.reader.id} className={g.overdueCount > 0 ? 'bg-destructive-soft/30' : undefined}>
                      <TD>
                        <p className="font-semibold text-ink">{g.reader.name}</p>
                        <p className="font-mono text-[12px] text-muted">{formatCPF(g.reader.cpf)}</p>
                      </TD>
                      <TD>
                        <span className="font-bold text-ink">{g.activeCount}</span>
                        <span className="text-muted"> {g.activeCount === 1 ? 'livro' : 'livros'}</span>
                      </TD>
                      <TD>
                        {g.overdueCount > 0 ? (
                          <Badge variant="destructive">{g.overdueCount} atrasado{g.overdueCount === 1 ? '' : 's'}</Badge>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </TD>
                      <TD className="text-right">
                        <Link to={`/admin/devolucoes/${g.reader.id}`}>
                          <Button size="sm">
                            Receber <ArrowRight className="size-3.5" />
                          </Button>
                        </Link>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
            <Pagination
              page={page}
              totalPages={data.totalPages}
              onPageChange={(p) => {
                const next = new URLSearchParams(params);
                if (p > 1) next.set('page', String(p));
                else next.delete('page');
                setParams(next);
              }}
            />
          </>
        )
      )}
    </div>
  );
}
