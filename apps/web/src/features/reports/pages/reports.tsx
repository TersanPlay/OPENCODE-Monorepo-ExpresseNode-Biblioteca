import { useEffect, useState } from 'react';
import { BarChart3, Download } from 'lucide-react';
import { FaFilePdf } from 'react-icons/fa';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { EmptyState } from '../../../components/ui/empty-state';
import { Label } from '../../../components/ui/form-field';
import { Pagination } from '../../../components/ui/pagination';
import { Select } from '../../../components/ui/select';
import { Skeleton } from '../../../components/ui/skeleton';
import { TD, TH, TBody, THead, TR, Table } from '../../../components/ui/table';
import { reportsApi } from '../../api';
import { categoriesApi } from '../../categories/api';
import type { Params } from '../../http';
import type { Category } from '../../../types/api';
import { useApiToast } from '../../toast/toast-provider';
import { apiErrorMessage } from '../../../lib/errors';
import { formatDateTime, formatDate } from '../../../lib/format';
import type { ReportResult, ReportType } from '../../../types/api';

const REPORT_TYPES: { value: ReportType; label: string }[] = [
  { value: 'acervo', label: 'Acervo completo' },
  { value: 'available', label: 'Livros disponíveis' },
  { value: 'loaned', label: 'Livros emprestados' },
  { value: 'overdue', label: 'Empréstimos atrasados' },
  { value: 'loans-period', label: 'Empréstimos por período' },
  { value: 'returns-period', label: 'Devoluções por período' },
  { value: 'active-readers', label: 'Leitores ativos' },
  { value: 'top-books', label: 'Livros mais emprestados' },
  { value: 'categories', label: 'Distribuição por categoria' },
];

const WEEKS: Record<'7d' | '30d' | '90d', { label: string; days: number }> = {
  '7d': { label: '7 dias', days: 7 },
  '30d': { label: '30 dias', days: 30 },
  '90d': { label: '90 dias', days: 90 },
};

const LIMITS = [
  { value: '10', label: '10 linhas' },
  { value: '25', label: '25 linhas' },
  { value: '50', label: '50 linhas' },
  { value: '100', label: '100 linhas' },
];

const CATEGORY_TYPES: ReportType[] = ['acervo', 'available', 'loaned', 'overdue', 'loans-period', 'returns-period', 'top-books', 'categories'];
const LIMIT_TYPES: ReportType[] = ['available', 'loaned', 'overdue', 'loans-period', 'returns-period', 'active-readers', 'top-books', 'categories'];

export function ReportsPage() {
  const [type, setType] = useState<ReportType>('acervo');
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d');
  const [categoryId, setCategoryId] = useState('');
  const [limit, setLimit] = useState('10');
  const [categories, setCategories] = useState<Category[]>([]);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [acervoMetrics, setAcervoMetrics] = useState<ReportResult | null>(null);
  const [acervoPage, setAcervoPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [paging, setPaging] = useState(false);
  const { toast } = useApiToast();

  const needsPeriod = type === 'loans-period' || type === 'returns-period';
  const needsCategory = CATEGORY_TYPES.includes(type);
  const needsLimit = LIMIT_TYPES.includes(type);

  useEffect(() => {
    categoriesApi.all().then(setCategories).catch(() => setCategories([]));
  }, []);

  const isAcervo = type === 'acervo';

  const fetchAcervoList = async (page: number, catId: string) => {
    const params: Params = { page };
    if (catId) params.categoryId = Number(catId);
    return reportsApi.generate('acervo-livros', params);
  };

  const generate = async () => {
    setLoading(true);
    setResult(null);
    try {
      const params: Params = {};
      if (needsPeriod) {
        params.start = new Date(Date.now() - WEEKS[period].days * 86400000).toISOString();
        params.end = new Date().toISOString();
      }
      if (needsCategory && categoryId) params.categoryId = Number(categoryId);
      if (needsLimit) params.limit = Number(limit);
      if (isAcervo) {
        setAcervoPage(1);
        const [metrics, list] = await Promise.all([
          reportsApi.generate('acervo', needsCategory && categoryId ? { categoryId: Number(categoryId) } : undefined),
          fetchAcervoList(1, needsCategory ? categoryId : ''),
        ]);
        setAcervoMetrics(metrics);
        setResult(list);
      } else {
        setAcervoMetrics(null);
        setResult(await reportsApi.generate(type, params));
      }
    } catch (err) {
      toast.error('Não foi possível gerar o relatório', apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const changeAcervoPage = async (p: number) => {
    if (paging || p === acervoPage) return;
    setPaging(true);
    try {
      const list = await fetchAcervoList(p, needsCategory ? categoryId : '');
      setResult(list);
      setAcervoPage(p);
    } catch (err) {
      toast.error('Não foi possível paginar', apiErrorMessage(err));
    } finally {
      setPaging(false);
    }
  };

  const downloadPDF = async () => {
    setLoading(true);
    try {
      if (isAcervo) {
        const params: Params = { page: acervoPage };
        if (needsCategory && categoryId) params.categoryId = Number(categoryId);
        await reportsApi.exportPdf('acervo-livros', params);
      } else {
        const params: Params = {};
        if (needsPeriod) {
          params.start = new Date(Date.now() - WEEKS[period].days * 86400000).toISOString();
          params.end = new Date().toISOString();
        }
        if (needsCategory && categoryId) params.categoryId = Number(categoryId);
        if (needsLimit) params.limit = Number(limit);
        await reportsApi.exportPdf(type, params);
      }
    } catch (err) {
      toast.error('Não foi possível exportar o PDF', apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const downloadCSV = () => {
    if (!result) return;
    const header = result.columns.join(';');
    const lines = result.rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';'));
    const csv = [header, ...lines].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio-${type}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formattedColumn = (value: string | number | null) => {
    if (value === null || value === undefined || value === '') return '—';
    const s = String(value);
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return formatDateTime(s);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return formatDate(s);
    return s;
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Gerar relatório</CardTitle>
          <p className="text-[13px] text-muted">
            Escolha um modelo e clique em gerar. Os dados podem ser exportados em CSV.
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <Label>Modelo</Label>
            <Select
              value={type}
              onValueChange={(v) => setType(v as ReportType)}
              options={REPORT_TYPES.map((r) => ({ value: r.value, label: r.label }))}
            />
          </div>
          {needsPeriod && (
            <div className="w-36">
              <Label>Período</Label>
              <Select
                value={period}
                onValueChange={(v) => setPeriod(v as '7d' | '30d' | '90d')}
                options={Object.entries(WEEKS).map(([v, w]) => ({ value: v, label: w.label }))}
              />
            </div>
          )}
          {needsCategory && (
            <div className="w-52">
              <Label>Categoria</Label>
              <Select
                value={categoryId || 'all'}
                onValueChange={(v) => setCategoryId(v === 'all' ? '' : v)}
                options={[{ value: 'all', label: 'Todas as categorias' }, ...categories.map((c) => ({ value: String(c.id), label: c.name }))]}
              />
            </div>
          )}
          {needsLimit && (
            <div className="w-36">
              <Label>Limite</Label>
              <Select
                value={limit}
                onValueChange={setLimit}
                options={LIMITS}
              />
            </div>
          )}
          <Button onClick={generate} loading={loading}>
            <BarChart3 className="size-4" /> Gerar relatório
          </Button>
        </CardContent>
      </Card>

      {loading ? (
        <Card className="p-4">
          <Skeleton className="mb-4 h-6 w-56" />
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="mb-2.5 h-10" />
          ))}
        </Card>
      ) : result ? (
        <div className="space-y-5">
          {isAcervo && acervoMetrics && acervoMetrics.rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-card bg-surface px-5 py-3 hairline">
              {acervoMetrics.rows.map((row, i) => (
                <span key={i} className="inline-flex items-baseline gap-1.5 text-[12.5px]">
                  <span className="font-semibold text-muted">{formattedColumn(row[0])}:</span>
                  <span className="font-extrabold tabular-nums text-ink">{formattedColumn(row[1])}</span>
                </span>
              ))}
            </div>
          )}
        <Card className="overflow-hidden p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/8 p-5 pb-4">
            <div>
              <h2 className="text-[15px] font-bold text-ink">
                {isAcervo ? 'Acervo completo' : REPORT_TYPES.find((r) => r.value === result.type)?.label ?? result.type}
              </h2>
              <p className="mt-0.5 text-[12px] text-muted">
                Gerado em {formatDateTime(result.generatedAt)} ·{' '}
                {result.total ?? result.rows.length} linha{(result.total ?? result.rows.length) === 1 ? '' : 's'}
                {needsPeriod ? ` · período de ${WEEKS[period].label}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={downloadCSV}>
                <Download className="size-4" /> Exportar CSV
              </Button>
              <Button variant="secondary" size="sm" onClick={() => void downloadPDF()}>
                <FaFilePdf className="size-4 text-[#D32F2F]" /> Exportar PDF
              </Button>
            </div>
          </div>
          {result.rows.length === 0 ? (
            <EmptyState
              compact
              title="Sem dados para os filtros selecionados"
              description={needsPeriod ? `Nada no período de ${WEEKS[period].label}.` : undefined}
            />
          ) : (
            <div className={paging ? 'pointer-events-none opacity-60 transition-opacity' : 'transition-opacity'} aria-busy={paging}>
              <Table>
                <THead>
                  <TR>
                    {result.columns.map((c) => (
                      <TH key={c}>{c}</TH>
                    ))}
                  </TR>
                </THead>
                <TBody>
                  {result.rows.map((row, i) => (
                    <TR key={i}>
                      {row.map((cell, j) => (
                        <TD key={j} className={j === 0 ? undefined : 'whitespace-nowrap'}>
                          {j === 2 && isAcervo ? (
                            <Badge variant={cell === 'Disponível' ? 'success' : cell === 'Emprestado' ? 'warning' : 'neutral'} dot>
                              {String(cell)}
                            </Badge>
                          ) : (
                            formattedColumn(cell)
                          )}
                        </TD>
                      ))}
                    </TR>
                  ))}
                </TBody>
              </Table>
              {isAcervo && (result.totalPages ?? 0) > 1 && (
                <Pagination
                  className="px-5 py-4"
                  page={acervoPage}
                  totalPages={result.totalPages ?? 1}
                  onPageChange={(p) => void changeAcervoPage(p)}
                />
              )}
            </div>
          )}
        </Card>
        </div>
      ) : (
        <Card variant="blue">
          <EmptyState
            compact
            title="Nenhum relatório gerado"
            description="Selecione um modelo acima e clique em gerar."
          />
        </Card>
      )}
    </div>
  );
}