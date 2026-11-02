import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  Square,
  X,
  Zap,
} from 'lucide-react';
import type {
  CatalogUpdateAnalysis,
  CatalogUpdateJobSummary,
  CatalogUpdateRow,
} from '@library/shared';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { ConfirmDialog } from '../../../components/ui/confirm-dialog';
import { EmptyState } from '../../../components/ui/empty-state';
import { Input } from '../../../components/ui/input';
import { PageHeader } from '../../../components/ui/page-header';
import { Pagination } from '../../../components/ui/pagination';
import { Select } from '../../../components/ui/select';
import { Skeleton } from '../../../components/ui/skeleton';
import { Switch } from '../../../components/ui/switch';
import { TD, TH, TBody, THead, TR, Table } from '../../../components/ui/table';
import { catalogUpdateApi, type CatalogReportKind } from '../api';
import { useDebounce } from '../../hooks/use-debounce';
import { useApiToast } from '../../toast/toast-provider';
import { apiErrorMessage } from '../../../lib/errors';
import { formatDateTime } from '../../../lib/format';

type Tab = 'PENDING' | 'UPDATED' | 'MISSING_ISBN';
type BadgeVariant = 'neutral' | 'primary' | 'success' | 'warning' | 'destructive' | 'gold';

const SIMULATION_KEY = 'catalog_update_simulation';
const APPLY_KEY = 'catalog_update_apply';
const ACTIVE_KEY = 'catalog_update_active';
const AUTO_KEY = 'catalog_update_auto_apply';

const PROCESS_BADGE: Record<string, { label: string; variant: BadgeVariant }> = {
  UPDATED: { label: 'Atualizado', variant: 'success' },
  UNCHANGED: { label: 'Sem alterações', variant: 'primary' },
  NOT_FOUND: { label: 'Não encontrado', variant: 'warning' },
  ERROR: { label: 'Erro', variant: 'destructive' },
};

const QUERY_BADGE: Record<string, { label: string; variant: BadgeVariant }> = {
  PENDING: { label: 'Pendente', variant: 'neutral' },
  FOUND: { label: 'Encontrado', variant: 'success' },
  NOT_FOUND: { label: 'Não encontrado', variant: 'warning' },
  ERROR: { label: 'Erro', variant: 'destructive' },
  SKIPPED: { label: 'Ignorado', variant: 'neutral' },
};


const TAB_FILTERS: Record<Tab, { value: string; label: string }[]> = {
  PENDING: [
    { value: 'ALL', label: 'Todos os pendentes' },
    { value: 'UNPROCESSED', label: 'Nunca processados' },
    { value: 'INVALID_ISBN', label: 'ISBN inválido' },
    { value: 'NOT_FOUND', label: 'Não encontrados na ISBNdb' },
    { value: 'ERROR', label: 'Com erro de consulta' },
  ],
  UPDATED: [
    { value: 'ALL', label: 'Todos os concluídos' },
    { value: 'UPDATED', label: 'Atualizados' },
    { value: 'UNCHANGED', label: 'Sem alterações' },
  ],
  MISSING_ISBN: [{ value: 'ALL', label: 'Livros sem ISBN' }],
};

function rowBadge(row: CatalogUpdateRow) {
  if (row.rowState === 'MISSING_ISBN') {
    return { label: 'Sem ISBN', variant: 'warning' as BadgeVariant };
  }
  if (row.status === 'INVALID_ISBN') {
    return { label: 'ISBN inválido', variant: 'destructive' as BadgeVariant };
  }
  if (row.processStatus) {
    return PROCESS_BADGE[row.processStatus] ?? { label: row.processStatus, variant: 'neutral' as BadgeVariant };
  }
  return { label: 'Não processado', variant: 'neutral' as BadgeVariant };
}

function valueLabel(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function changeCount(row: CatalogUpdateRow): number {
  return (row.changes?.length ?? 0) + (row.authorChanges ? 1 : 0);
}

function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return 'calculando…';
  if (seconds < 1) return 'menos de 1s';
  if (seconds < 60) return `~${Math.ceil(seconds)}s`;
  if (seconds < 3600) return `~${Math.ceil(seconds / 60)} min`;
  return `~${(seconds / 3600).toFixed(1)} h`;
}

export function CatalogUpdatePage() {
  const { toast } = useApiToast();
  const [analysis, setAnalysis] = useState<CatalogUpdateAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(true);

  const [tab, setTab] = useState<Tab>('PENDING');
  const [filter, setFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 350);
  const [page, setPage] = useState(1);
  const [reloadToken, setReloadToken] = useState(0);

  const [rows, setRows] = useState<{
    items: CatalogUpdateRow[];
    total: number;
    page: number;
    totalPages: number;
  } | null>(null);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [rowsError, setRowsError] = useState<string | null>(null);

  const [simulation, setSimulation] = useState<CatalogUpdateJobSummary | null>(null);
  const [applyJob, setApplyJob] = useState<CatalogUpdateJobSummary | null>(null);
  const [activeJob, setActiveJob] = useState<CatalogUpdateJobSummary | null>(null);
  const [appliedSimulationId, setAppliedSimulationId] = useState<string | null>(null);

  const [showSimulationRows, setShowSimulationRows] = useState(false);
  const [simFilter, setSimFilter] = useState('CHANGES');
  const [simPage, setSimPage] = useState(1);
  const [simRows, setSimRows] = useState<{
    items: CatalogUpdateRow[];
    total: number;
    page: number;
    totalPages: number;
  } | null>(null);
  const [simLoading, setSimLoading] = useState(false);

  const [simulateOpen, setSimulateOpen] = useState(false);
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [limit, setLimit] = useState('50');
  const [delayMs, setDelayMs] = useState('1100');
  const [autoApply, setAutoApply] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reprocessRow, setReprocessRow] = useState<CatalogUpdateRow | null>(null);
  const [drawer, setDrawer] = useState<
    { row: CatalogUpdateRow; source: 'db' | 'simulation' } | null
  >(null);

  const reload = () => setReloadToken((value) => value + 1);

  useEffect(() => {
    setFilter('ALL');
    setPage(1);
  }, [tab]);

  useEffect(() => {
    let alive = true;
    setAnalysisLoading(true);
    setAnalysisError(null);
    catalogUpdateApi
      .analysis()
      .then((data) => {
        if (alive) setAnalysis(data);
      })
      .catch((err) => {
        if (alive) setAnalysisError(apiErrorMessage(err));
      })
      .finally(() => {
        if (alive) setAnalysisLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [reloadToken]);

  useEffect(() => {
    let alive = true;
    setRowsLoading(true);
    setRowsError(null);

    const params: Record<string, string | number | undefined> = {
      state: tab,
      page,
      pageSize: 20,
      search: debouncedSearch || undefined,
    };
    if (tab !== 'MISSING_ISBN' && filter !== 'ALL') params.status = filter;

    catalogUpdateApi
      .books(params)
      .then((result) => {
        if (alive) setRows(result);
      })
      .catch((err) => {
        if (alive) setRowsError(apiErrorMessage(err));
      })
      .finally(() => {
        if (alive) setRowsLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [tab, filter, debouncedSearch, page, reloadToken]);

  useEffect(() => {
    const simulationId = sessionStorage.getItem(SIMULATION_KEY);
    const applyId = sessionStorage.getItem(APPLY_KEY);
    const activeId = sessionStorage.getItem(ACTIVE_KEY);
    let alive = true;

    const restore = async () => {
      try {
        let restoredSimulation: CatalogUpdateJobSummary | null = null;
        if (simulationId) {
          const job = await catalogUpdateApi.job(simulationId);
          restoredSimulation = job;
          if (alive) {
            setSimulation(job);
            setShowSimulationRows(true);
          }
        }
        if (applyId) {
          const job = await catalogUpdateApi.job(applyId);
          if (alive) {
            setApplyJob(job);
            if (job.simulationId) setAppliedSimulationId(job.simulationId);
          }
          sessionStorage.removeItem(AUTO_KEY);
        }
        if (activeId) {
          const job = await catalogUpdateApi.job(activeId);
          if (!alive) return;
          if (job.status === 'RUNNING') {
            setActiveJob(job);
          } else {
            sessionStorage.removeItem(ACTIVE_KEY);
            if (job.mode === 'SIMULATE') {
              setSimulation(job);
              setShowSimulationRows(true);
              sessionStorage.setItem(SIMULATION_KEY, job.id);
            } else {
              setApplyJob(job);
              sessionStorage.setItem(APPLY_KEY, job.id);
              if (job.simulationId) setAppliedSimulationId(job.simulationId);
            }
          }
        }

        const autoId = sessionStorage.getItem(AUTO_KEY);
        if (
          autoId &&
          restoredSimulation?.id === autoId &&
          restoredSimulation.status === 'COMPLETED' &&
          !applyId
        ) {
          sessionStorage.removeItem(AUTO_KEY);
          try {
            const applied = await catalogUpdateApi.apply(autoId);
            if (alive) {
              setActiveJob(applied);
              sessionStorage.setItem(ACTIVE_KEY, applied.id);
            }
          } catch (err) {
            toast.error('Falha ao aplicar automaticamente', apiErrorMessage(err));
          }
        }
      } catch {
        sessionStorage.removeItem(SIMULATION_KEY);
        sessionStorage.removeItem(APPLY_KEY);
        sessionStorage.removeItem(ACTIVE_KEY);
      }
    };

    void restore();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!simulation || !showSimulationRows) {
      setSimRows(null);
      return;
    }
    let alive = true;
    setSimLoading(true);
    const params: Record<string, string | number | undefined> = {
      page: simPage,
      pageSize: 10,
      search: debouncedSearch || undefined,
    };
    if (simFilter === 'CHANGES') params.onlyChanges = 1;
    else if (simFilter !== 'ALL') params.result = simFilter;

    catalogUpdateApi
      .jobRows(simulation.id, params)
      .then((result) => {
        if (alive) setSimRows(result);
      })
      .catch(() => {
        if (alive) setSimRows(null);
      })
      .finally(() => {
        if (alive) setSimLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [simulation, showSimulationRows, simFilter, simPage, debouncedSearch, reloadToken]);

  useEffect(() => {
    const jobId = activeJob?.id;
    if (!jobId || activeJob?.status !== 'RUNNING') return;
    const timer = window.setInterval(async () => {
      try {
        const job = await catalogUpdateApi.job(jobId);
        if (job.status === 'RUNNING') {
          setActiveJob(job);
          return;
        }
        setActiveJob(null);
        sessionStorage.removeItem(ACTIVE_KEY);
        if (job.mode === 'SIMULATE') {
          setSimulation(job);
          setApplyJob(null);
          setAppliedSimulationId(null);
          setShowSimulationRows(true);
          setSimFilter('CHANGES');
          setSimPage(1);
          sessionStorage.setItem(SIMULATION_KEY, job.id);
          sessionStorage.removeItem(APPLY_KEY);

          if (job.applied) {
            sessionStorage.removeItem(AUTO_KEY);
            setAppliedSimulationId(job.id);
            toast.info('Resultados parciais registrados', job.message ?? undefined);
          } else {
            toast.success('Simulação concluída', job.message ?? undefined);
            if (sessionStorage.getItem(AUTO_KEY) === job.id) {
              sessionStorage.removeItem(AUTO_KEY);
              try {
                const applied = await catalogUpdateApi.apply(job.id);
                sessionStorage.setItem(ACTIVE_KEY, applied.id);
                setActiveJob(applied);
                toast.info(
                  'Aplicando em segundo plano',
                  'A simulação foi concluída; registrando os resultados e aplicando as alterações.',
                );
              } catch (err) {
                toast.error('Falha ao aplicar automaticamente', apiErrorMessage(err));
              }
            }
          }
        } else {
          setApplyJob(job);
          sessionStorage.setItem(APPLY_KEY, job.id);
          if (job.simulationId) setAppliedSimulationId(job.simulationId);
          toast.success(
            job.cancelRequested ? 'Processo interrompido' : 'Atualização concluída',
            job.message ?? undefined,
          );
        }
        reload();
      } catch {
        // Falhas pontuais de polling são ignoradas; a próxima consulta corrige.
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [activeJob?.id, activeJob?.status, toast]);

  const resetSimulation = () => {
    setSimulation(null);
    setApplyJob(null);
    setAppliedSimulationId(null);
    setShowSimulationRows(false);
    setSimRows(null);
    sessionStorage.removeItem(SIMULATION_KEY);
    sessionStorage.removeItem(APPLY_KEY);
    sessionStorage.removeItem(AUTO_KEY);
  };

  const startSimulation = async (bookIds?: number[], auto = false, allPending = false) => {
    setBusy(true);
    try {
      const job = await catalogUpdateApi.simulate({
        limit: allPending ? null : bookIds ? 1 : limit === 'all' ? null : Number(limit),
        delayMs: Number(delayMs) || 0,
        bookIds,
      });
      const shouldAutoApply = Boolean(auto && !bookIds);
      if (!bookIds) resetSimulation();
      else {
        setApplyJob(null);
        setAppliedSimulationId(null);
        sessionStorage.removeItem(APPLY_KEY);
      }
      if (shouldAutoApply) sessionStorage.setItem(AUTO_KEY, job.id);
      else sessionStorage.removeItem(AUTO_KEY);
      sessionStorage.setItem(ACTIVE_KEY, job.id);
      setActiveJob(job);
      setSimulateOpen(false);
      setBackgroundOpen(false);
      setReprocessRow(null);
      toast.info(
        'Simulação iniciada',
        bookIds
          ? 'Reprocessamento manual iniciado para o livro selecionado.'
          : shouldAutoApply
            ? 'Processando em segundo plano; as alterações serão aplicadas ao concluir.'
            : 'Somente livros pendentes serão consultados. Nenhum dado foi gravado.',
      );
    } catch (err) {
      toast.error('Erro ao simular', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const startApply = async () => {
    if (!simulation) return;
    setBusy(true);
    try {
      const job = await catalogUpdateApi.apply(simulation.id);
      setApplyOpen(false);
      sessionStorage.setItem(ACTIVE_KEY, job.id);
      setActiveJob(job);
      toast.info('Atualização iniciada', 'Os resultados simulados estão sendo registrados.');
    } catch (err) {
      toast.error('Erro ao atualizar', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const stopProcessing = async () => {
    if (!activeJob) return;
    setStopping(true);
    try {
      const job = await catalogUpdateApi.stopJob(activeJob.id);
      sessionStorage.removeItem(AUTO_KEY);
      setActiveJob(job);
      setStopOpen(false);
      toast.info(
        'Parada solicitada',
        job.mode === 'APPLY'
          ? 'O registro restante será interrompido; os livros já gravados permanecem.'
          : 'As consultas serão interrompidas e os resultados já obtidos serão aplicados.',
      );
    } catch (err) {
      toast.error('Erro ao parar', apiErrorMessage(err));
    } finally {
      setStopping(false);
    }
  };

  const downloadReport = async (kind: CatalogReportKind, filename: string) => {
    try {
      await catalogUpdateApi.downloadReport(kind, filename);
    } catch (err) {
      toast.error('Erro ao baixar relatório', apiErrorMessage(err));
    }
  };

  const counts = analysis?.counts;
  const failures = (counts?.notFound ?? 0) + (counts?.errors ?? 0);
  const canSimulate = Boolean(analysis?.apiConfigured) && !activeJob && !busy;
  const simulationHasResults = Boolean(
    simulation &&
      simulation.status === 'COMPLETED' &&
      simulation.found + simulation.notFound + simulation.errors > 0,
  );
  const canApply =
    simulationHasResults &&
    !activeJob &&
    !busy &&
    appliedSimulationId !== simulation?.id;

  const progress = useMemo(() => {
    if (!activeJob || activeJob.total <= 0) return 0;
    return Math.min(100, Math.round((activeJob.processed / activeJob.total) * 100));
  }, [activeJob]);

  const etaSeconds = useMemo(() => {
    if (!activeJob || activeJob.processed <= 0) return null;
    const elapsed = (Date.now() - new Date(activeJob.startedAt).getTime()) / 1000;
    if (elapsed <= 0) return null;
    const rate = activeJob.processed / elapsed;
    if (rate <= 0) return null;
    return Math.max(0, (activeJob.total - activeJob.processed) / rate);
  }, [activeJob]);

  const isApplying = Boolean(
    activeJob && (activeJob.mode === 'APPLY' || activeJob.phase === 'APPLY'),
  );

  const jobMeta = activeJob
    ? [
        activeJob.planName ? `Plano ${activeJob.planName}` : null,
        activeJob.bulkSize && activeJob.bulkSize > 1 ? `Lotes de ${activeJob.bulkSize}` : null,
        activeJob.quotaRemaining !== undefined && activeJob.quotaRemaining !== null
          ? `Cota restante ${activeJob.quotaRemaining}`
          : null,
        activeJob.httpRequests ? `${activeJob.httpRequests} requisições` : null,
      ].filter((item): item is string => Boolean(item))
    : [];

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'PENDING', label: 'Pendentes', count: counts?.pending ?? 0 },
    { id: 'UPDATED', label: 'Atualizados', count: counts?.completed ?? 0 },
    { id: 'MISSING_ISBN', label: 'Sem ISBN', count: counts?.withoutIsbn ?? 0 },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Atualização Cadastral"
        description="Controle persistente por livro. Simulações não alteram o acervo; a aplicação registra data, origem e resultado."
        actions={
          <>
            <Button variant="secondary" onClick={reload} loading={analysisLoading}>
              <RefreshCw className="size-4" /> Analisar acervo
            </Button>
            <Button variant="soft" onClick={() => setSimulateOpen(true)} disabled={!canSimulate}>
              <Sparkles className="size-4" /> Simular atualização
            </Button>
            <Button
              variant="gold"
              onClick={() => setBackgroundOpen(true)}
              disabled={!canSimulate || (counts?.pending ?? 0) === 0}
              title="Atualiza todos os pendentes em segundo plano e aplica ao concluir"
            >
              <Zap className="size-4" /> Atualizar pendentes
            </Button>
            <Button onClick={() => setApplyOpen(true)} disabled={!canApply}>
              <Play className="size-4" /> Executar atualização
            </Button>
          </>
        }
      />

      {analysisError && (
        <Card variant="soft" className="border-l-[3px] border-l-destructive p-4">
          <p className="text-sm font-semibold text-destructive">{analysisError}</p>
        </Card>
      )}

      {analysis && !analysis.apiConfigured && (
        <Card variant="soft" className="flex items-start gap-3 border-l-[3px] border-l-warning p-4">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" />
          <div>
            <p className="text-sm font-bold text-ink">ISBNdb não configurada</p>
            <p className="mt-0.5 text-[13px] text-muted">
              Defina <code className="font-mono text-[12px]">ISBNDB_API_KEY</code> em{' '}
              <code className="font-mono text-[12px]">apps/api/.env</code> (ou como secret do Worker)
              para simular e atualizar. A análise, as abas e os relatórios continuam disponíveis.
            </p>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {[
          { label: 'Total', value: counts?.totalBooks },
          { label: 'Pendentes', value: counts?.pending },
          { label: 'Atualizados', value: counts?.updated },
          { label: 'Sem alterações', value: counts?.unchanged },
          { label: 'Sem ISBN', value: counts?.withoutIsbn },
          { label: 'ISBN inválido', value: counts?.invalidIsbn },
          { label: 'Não encontrados', value: counts?.notFound },
          { label: 'Erros', value: counts?.errors },
        ].map((item) => (
          <Card key={item.label} className="p-4">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted">
              {item.label}
            </p>
            {analysisLoading && !counts ? (
              <Skeleton className="mt-2 h-7 w-14" />
            ) : (
              <p className="mt-1 text-2xl font-extrabold tracking-tight text-ink">
                {item.value ?? 0}
              </p>
            )}
          </Card>
        ))}
      </div>

      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="text-sm font-bold text-ink">Relatórios Markdown</p>
          <p className="mt-0.5 text-[12.5px] text-muted">
            Livros sem ISBN ({counts?.withoutIsbn ?? 0}) e ISBNs inválidos ({counts?.invalidIsbn ?? 0}).
            Livros sem ISBN ficam fora da atualização automática.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void downloadReport('livros-sem-isbn', 'livros-sem-isbn.md')}
          >
            <Download className="size-4" /> Baixar sem ISBN
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void downloadReport('isbns-invalidos', 'isbns-invalidos.md')}
          >
            <Download className="size-4" /> Baixar inválidos
          </Button>
        </div>
      </Card>

{activeJob && activeJob.status === 'RUNNING' && (
        <Card className="relative overflow-hidden border-0 p-0">
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                'radial-gradient(120% 90% at 8% 0%, rgba(8,127,140,.16), transparent 55%), radial-gradient(90% 80% at 95% 8%, rgba(200,155,91,.14), transparent 50%)',
            }}
          />
          <div
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{
              backgroundImage:
                'linear-gradient(rgba(23,26,26,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(23,26,26,.045) 1px, transparent 1px)',
              backgroundSize: '22px 22px',
            }}
          />
          <span className="anim-float pointer-events-none absolute right-14 top-8 size-1.5 rounded-full bg-gold/80" />
          <span
            className="anim-float pointer-events-none absolute right-28 top-16 size-1 rounded-full bg-primary/50"
            style={{ animationDelay: '1.2s' }}
          />
          <span
            className="anim-float pointer-events-none absolute left-1/3 top-6 size-1 rounded-full bg-primary/30"
            style={{ animationDelay: '2.1s' }}
          />
          <div className="pointer-events-none absolute -right-10 -top-14 size-40 rounded-full border border-primary/10" />
          <div className="pointer-events-none absolute -right-4 -top-8 size-24 rounded-full border border-gold/20" />

          <div className="relative p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-white/70 shadow-[inset_0_0_0_1px_rgba(23,26,26,.06)]">
                  <span className="anim-orbit absolute inset-0 rounded-full border border-primary/30 border-t-primary" />
                  <RefreshCw className="size-4 text-primary" />
                </span>
                <div>
                  <p className="text-sm font-extrabold tracking-tight text-ink">
                    Atualização em segundo plano
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-muted">
                    {isApplying
                      ? activeJob.cancelRequested
                        ? 'Parando: registrando os resultados já obtidos.'
                        : 'Registrando resultados e aplicando as alterações.'
                      : activeJob.cancelRequested
                        ? 'Parando após a consulta atual…'
                        : 'Consultando a ISBNdb — nenhuma gravação nesta etapa.'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-2 rounded-full bg-white/65 px-3 py-1.5 font-mono text-[11px] font-semibold text-primary-dark shadow-[inset_0_0_0_1px_rgba(8,127,140,.14)]">
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/50" />
                    <span className="relative inline-flex size-2 rounded-full bg-primary" />
                  </span>
                  {activeJob.processed}/{activeJob.total} · {progress}%
                </span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setStopOpen(true)}
                  disabled={stopping || activeJob.cancelRequested}
                  title="Parar e aplicar os resultados já obtidos"
                >
                  <Square className="size-3.5 fill-current" />
                  {activeJob.cancelRequested ? 'Parando…' : 'Parar'}
                </Button>
              </div>
            </div>

            <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/70 shadow-[inset_0_0_0_1px_rgba(23,26,26,.06)]">
              <div
                className="relative h-full overflow-hidden rounded-full transition-all duration-700 [transition-timing-function:var(--ease)]"
                style={{
                  width: `${Math.max(progress, 2)}%`,
                  backgroundImage: 'linear-gradient(90deg, #087F8C 0%, #0FA3B1 60%, #7CC6CA 100%)',
                }}
              >
                <span className="anim-shimmer absolute inset-y-0 left-0 w-1/3 bg-white/40 blur-[2px]" />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { label: 'Processados', value: `${activeJob.processed}/${activeJob.total}` },
                { label: 'Encontrados', value: activeJob.found },
                { label: 'Não encontrados', value: activeJob.notFound },
                { label: 'Ignorados', value: activeJob.skipped },
                { label: 'Erros', value: activeJob.errors },
                isApplying
                  ? { label: 'Atualizados', value: activeJob.updated }
                  : { label: 'Com alterações', value: activeJob.changedBooks },
              ].map((metric) => (
                <div
                  key={metric.label}
                  className="rounded-control bg-white/55 px-2.5 py-2 shadow-[inset_0_0_0_1px_rgba(23,26,26,.06)]"
                >
                  <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
                    {metric.label}
                  </p>
                  <p className="mt-0.5 font-mono text-[15px] font-bold text-ink">{metric.value}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {jobMeta.length > 0 ? (
                  jobMeta.map((item) => (
                    <span
                      key={item}
                      className="rounded-full bg-white/60 px-2.5 py-1 font-mono text-[10.5px] font-semibold text-muted shadow-[inset_0_0_0_1px_rgba(23,26,26,.05)]"
                    >
                      {item}
                    </span>
                  ))
                ) : (
                  <span className="font-mono text-[10.5px] text-muted">
                    {activeJob.apiCalls} chamadas de cota
                  </span>
                )}
              </div>
              <span className="font-mono text-[11px] text-muted">
                {isApplying
                  ? `Sem alterações ${activeJob.unchanged} · Conflitos ${activeJob.conflicts}`
                  : `Cota usada ${activeJob.apiCalls} · ETA ${formatEta(etaSeconds)}`}
              </span>
            </div>
          </div>
        </Card>
      )}

      {applyJob && (
        <Card variant="soft" className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="text-sm font-bold text-ink">
              Última execução: {formatDateTime(applyJob.finishedAt ?? applyJob.startedAt)}
            </p>
            <p className="mt-0.5 text-[13px] text-muted">
              {applyJob.processed} registros processados • {applyJob.updated} atualizados •{' '}
              {applyJob.unchanged} sem alterações • {applyJob.notFound} não encontrados •{' '}
              {applyJob.conflicts} conflitos • {applyJob.errors} erros
            </p>
          </div>
          <Badge variant={applyJob.status === 'COMPLETED' ? 'success' : 'destructive'}>
            {applyJob.status}
          </Badge>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/8 p-3">
          <div className="flex flex-wrap items-center gap-1">
            {tabs.map((item) => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`rounded-control px-3.5 py-2 text-[13px] font-semibold transition-colors ${
                  tab === item.id
                    ? 'bg-primary-soft text-primary-dark'
                    : 'text-muted hover:bg-canvas hover:text-ink'
                }`}
              >
                {item.label}
                <span className="ml-1.5 rounded-full bg-white/70 px-1.5 py-0.5 font-mono text-[11px]">
                  {item.count}
                </span>
              </button>
            ))}
          </div>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            <div className="relative min-w-52 flex-1 lg:max-w-xs">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Buscar por título, autor ou ISBN..."
                className="pl-10"
              />
            </div>
            {TAB_FILTERS[tab].length > 1 && (
              <div className="w-full shrink-0 sm:w-56">
                <Select
                  value={filter}
                  onValueChange={(value) => {
                    setFilter(value);
                    setPage(1);
                  }}
                  options={TAB_FILTERS[tab]}
                />
              </div>
            )}
          </div>
        </div>

        {rowsError ? (
          <div className="p-8 text-center">
            <p className="text-sm font-semibold text-destructive">{rowsError}</p>
          </div>
        ) : rowsLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-11" />
            ))}
          </div>
        ) : !rows || rows.items.length === 0 ? (
          <EmptyState
            title={
              tab === 'PENDING'
                ? 'Nenhum livro pendente'
                : tab === 'UPDATED'
                  ? 'Nenhum livro atualizado'
                  : 'Nenhum livro sem ISBN'
            }
            description={
              tab === 'PENDING'
                ? 'Todos os livros elegíveis já foram concluídos ou não há registros para os filtros.'
                : 'Os registros aparecem aqui após uma execução de atualização concluída.'
            }
            compact
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Livro</TH>
                {tab !== 'MISSING_ISBN' && <TH className="hidden md:table-cell">ISBN</TH>}
                {tab === 'MISSING_ISBN' ? (
                  <>
                    <TH className="hidden sm:table-cell">Autor(es)</TH>
                    <TH>Editora</TH>
                  </>
                ) : tab === 'UPDATED' ? (
                  <>
                    <TH>Situação</TH>
                    <TH className="hidden lg:table-cell">Última atualização</TH>
                    <TH className="hidden xl:table-cell">Origem</TH>
                  </>
                ) : (
                  <>
                    <TH>Situação</TH>
                    <TH className="hidden lg:table-cell">Motivo</TH>
                  </>
                )}
                <TH className="text-right">Ações</TH>
              </TR>
            </THead>
            <TBody>
              {rows.items.map((row) => {
                const badge = rowBadge(row);
                return (
                  <TR key={row.bookId}>
                    <TD>
                      <p className="font-bold text-ink">{row.title}</p>
                      {tab !== 'MISSING_ISBN' && (
                        <p className="mt-0.5 line-clamp-1 text-[12px] text-muted">
                          {row.authors.length > 0 ? row.authors.join(', ') : 'Autor não informado'}
                        </p>
                      )}
                    </TD>
                    {tab !== 'MISSING_ISBN' && (
                      <TD className="hidden font-mono text-[12px] text-muted md:table-cell">
                        {row.isbnUsed ?? row.isbn13 ?? row.isbn10 ?? '—'}
                      </TD>
                    )}
                    {tab === 'MISSING_ISBN' ? (
                      <>
                        <TD className="hidden text-[13px] text-muted sm:table-cell">
                          {row.authors.length > 0 ? row.authors.join(', ') : 'Não informado'}
                        </TD>
                        <TD className="text-[13px] text-muted">
                          {row.publisher ?? 'Não informado'}
                        </TD>
                      </>
                    ) : tab === 'UPDATED' ? (
                      <>
                        <TD>
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                        </TD>
                        <TD className="hidden text-[12.5px] text-muted lg:table-cell">
                          {formatDateTime(row.catalogUpdatedAt)}
                        </TD>
                        <TD className="hidden font-mono text-[12px] text-muted xl:table-cell">
                          {row.catalogUpdateSource ?? '—'}
                        </TD>
                      </>
                    ) : (
                      <>
                        <TD>
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                        </TD>
                        <TD className="hidden max-w-72 text-[12.5px] text-muted lg:table-cell">
                          <span className="line-clamp-2">{row.pendingReason ?? '—'}</span>
                        </TD>
                      </>
                    )}
                    <TD>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDrawer({ row, source: 'db' })}
                        >
                          Detalhes
                        </Button>
                        {tab === 'UPDATED' && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setReprocessRow(row)}
                            disabled={Boolean(activeJob) || busy}
                          >
                            Reprocessar
                          </Button>
                        )}
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>

      {rows && (
        <Pagination page={rows.page} totalPages={rows.totalPages} onPageChange={setPage} />
      )}

      {simulation && (
        <Card className="overflow-hidden p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/8 p-4">
            <div>
              <p className="text-sm font-bold text-ink">
                Simulação de {formatDateTime(simulation.startedAt)} (não grava dados)
              </p>
              <p className="mt-0.5 text-[12.5px] text-muted">
                {simulation.changedBooks} com alterações • {simulation.found} encontrados •{' '}
                {simulation.notFound} não encontrados • {simulation.errors} erros
                {appliedSimulationId === simulation.id ? ' • resultados já registrados' : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setShowSimulationRows((value) => !value)}
              >
                {showSimulationRows ? 'Ocultar resultados' : 'Ver resultados'}
              </Button>
              <Button size="sm" onClick={() => setApplyOpen(true)} disabled={!canApply}>
                <Play className="size-4" /> Executar
              </Button>
            </div>
          </div>

          {showSimulationRows && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 p-3">
                <p className="text-[12.5px] text-muted">
                  {simRows ? `${simRows.total} registro(s)` : 'Carregando…'}
                </p>
                <div className="w-full shrink-0 sm:w-56">
                  <Select
                    value={simFilter}
                    onValueChange={(value) => {
                      setSimFilter(value);
                      setSimPage(1);
                    }}
                    options={[
                      { value: 'CHANGES', label: 'Com alterações propostas' },
                      { value: 'FOUND', label: 'Encontrados' },
                      { value: 'NOT_FOUND', label: 'Não encontrados' },
                      { value: 'ERROR', label: 'Erros' },
                      { value: 'ALL', label: 'Todos consultados' },
                    ]}
                  />
                </div>
              </div>
              {simLoading ? (
                <div className="space-y-2 p-4">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <Skeleton key={index} className="h-10" />
                  ))}
                </div>
              ) : !simRows || simRows.items.length === 0 ? (
                <EmptyState title="Nenhum resultado nesta situação" compact />
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Livro</TH>
                      <TH className="hidden md:table-cell">ISBN consultado</TH>
                      <TH>Situação</TH>
                      <TH className="hidden lg:table-cell">Alterações</TH>
                      <TH className="text-right">Detalhes</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {simRows.items.map((row) => {
                      const badge = row.queryStatus
                        ? QUERY_BADGE[row.queryStatus]
                        : { label: '—', variant: 'neutral' as BadgeVariant };
                      return (
                        <TR key={row.bookId}>
                          <TD>
                            <p className="font-bold text-ink">{row.title}</p>
                            <p className="mt-0.5 line-clamp-1 text-[12px] text-muted">
                              {row.authors.join(', ') || 'Autor não informado'}
                            </p>
                          </TD>
                          <TD className="hidden font-mono text-[12px] text-muted md:table-cell">
                            {row.isbnUsed ?? '—'}
                          </TD>
                          <TD>
                            <Badge variant={badge.variant}>{badge.label}</Badge>
                          </TD>
                          <TD className="hidden text-[13px] text-muted lg:table-cell">
                            {changeCount(row) > 0
                              ? `${changeCount(row)} campo${changeCount(row) > 1 ? 's' : ''}`
                              : '—'}
                          </TD>
                          <TD className="text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setDrawer({ row, source: 'simulation' })}
                            >
                              Ver
                            </Button>
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              )}
              {simRows && (
                <div className="p-3">
                  <Pagination
                    page={simRows.page}
                    totalPages={simRows.totalPages}
                    onPageChange={setSimPage}
                  />
                </div>
              )}
            </>
          )}
        </Card>
      )}

      <ConfirmDialog
        open={stopOpen}
        onOpenChange={setStopOpen}
        title="Parar o processamento?"
        description={
          isApplying
            ? 'O registro restante será interrompido. Os livros já gravados permanecem atualizados; os demais continuam pendentes.'
            : 'As novas consultas à ISBNdb serão interrompidas e os resultados já obtidos serão aplicados e registrados. Livros ainda não consultados permanecem pendentes.'
        }
        confirmLabel={isApplying ? 'Parar registro' : 'Parar e aplicar'}
        loading={stopping}
        onConfirm={stopProcessing}
      >
        <div className="rounded-card bg-surfaceWarm p-3 text-[12.5px] text-muted">
          <p className="font-semibold text-ink">
            {activeJob?.processed ?? 0} de {activeJob?.total ?? 0} processados
          </p>
          <p className="mt-1">
            A parada ocorre após o lote/registro atual. A aba Atualizados e os contadores são
            atualizados automaticamente ao final.
          </p>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={backgroundOpen}
        onOpenChange={setBackgroundOpen}
        title="Atualizar todos os pendentes em segundo plano?"
        description="Consulta a ISBNdb para todos os livros pendentes com ISBN válido e, ao concluir, registra os resultados e aplica as alterações automaticamente."
        confirmLabel="Iniciar atualização"
        loading={busy}
        confirmDisabled={!analysis?.apiConfigured || (counts?.pending ?? 0) === 0}
        onConfirm={() => startSimulation(undefined, true, true)}
      >
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-card bg-surfaceWarm p-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-dark">
              <Zap className="size-4" />
            </span>
            <div>
              <p className="text-sm font-bold text-ink">
                {counts?.pending ?? 0} livro(s) pendente(s)
              </p>
              <p className="text-[12px] text-muted">
                {counts?.updated ?? 0} já atualizados • {counts?.withoutIsbn ?? 0} sem ISBN (fora do
                processo)
              </p>
            </div>
          </div>
          <ul className="space-y-1.5 rounded-card hairline p-3 text-[12px] text-muted">
            <li>• Lotes de até 100 ISBNs (plano Basic), respeitando ~1 requisição/segundo.</li>
            <li>• Usa o saldo diário disponível; o excedente permanece pendente para o próximo dia.</li>
            <li>• Simulação e aplicação executam em segundo plano, com progresso nesta página.</li>
            <li>• CDD, Cutter, categorias, subtítulo, volume e vínculos administrativos não mudam.</li>
            <li>• Se você sair da página, o progresso continua sendo consultado ao retornar.</li>
          </ul>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={simulateOpen}
        onOpenChange={setSimulateOpen}
        title={autoApply ? 'Atualizar pendentes em segundo plano?' : 'Simular atualização cadastral?'}
        description={
          autoApply
            ? 'Consulta a ISBNdb e, ao concluir, registra os resultados e aplica as alterações automaticamente. Por padrão, apenas livros pendentes com ISBN válido são processados; concluídos exigem reprocessamento manual.'
            : 'A simulação consulta a ISBNdb e monta a proposta. Por padrão, apenas livros pendentes com ISBN válido são consultados; concluídos exigem reprocessamento manual.'
        }
        confirmLabel={autoApply ? 'Iniciar atualização' : 'Iniciar simulação'}
        loading={busy}
        confirmDisabled={!analysis?.apiConfigured}
        onConfirm={() => startSimulation(undefined, autoApply)}
      >
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[12.5px] font-semibold text-ink">
              Limite de livros pendentes
            </span>
            <Select
              value={limit}
              onValueChange={setLimit}
              options={[
                { value: '50', label: '50 livros' },
                { value: '200', label: '200 livros' },
                { value: '500', label: '500 livros' },
                { value: '1000', label: '1.000 livros' },
                { value: 'all', label: 'Todos os pendentes elegíveis' },
              ]}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12.5px] font-semibold text-ink">
              Intervalo entre chamadas (ms)
            </span>
            <Input
              type="number"
              min={0}
              max={60000}
              step={100}
              value={delayMs}
              onChange={(event) => setDelayMs(event.target.value)}
            />
            <span className="mt-1 block text-[11.5px] text-muted">
              Plano Basic: ~1 requisição/segundo e 5.000 ISBNs/dia. Lotes de até 100
              ISBNs reduzem o tempo; cada ISBN consome cota.
            </span>
          </label>
          <div className="flex items-start justify-between gap-3 rounded-card bg-surfaceWarm p-3">
            <div>
              <p className="text-[12.5px] font-semibold text-ink">
                Aplicar automaticamente ao concluir
              </p>
              <p className="mt-0.5 text-[11.5px] text-muted">
                Atualização completa em segundo plano: ao fim da simulação, os resultados são
                registrados e as alterações aplicadas sem outra confirmação.
              </p>
            </div>
            <Switch checked={autoApply} onCheckedChange={setAutoApply} />
          </div>
          {failures > 0 && (
            <p className="rounded-card bg-surfaceWarm p-3 text-[12px] text-muted">
              {failures} registro(s) com falha/não encontrado continuam pendentes e serão tentados
              novamente na próxima simulação.
            </p>
          )}
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={applyOpen}
        onOpenChange={setApplyOpen}
        title="Executar atualização e registrar resultados?"
        description={
          simulation
            ? `Serão registrados os resultados da simulação de ${formatDateTime(
                simulation.startedAt,
              )}: alterações aplicadas, livros sem alterações, não encontrados e erros. Registros alterados desde a simulação ficam como conflito e não são sobrescritos.`
            : undefined
        }
        confirmLabel="Aplicar e registrar"
        loading={busy}
        onConfirm={startApply}
      >
        <div className="rounded-card bg-surfaceWarm p-3 text-[12.5px] text-muted">
          <p className="flex items-center gap-2 font-semibold text-ink">
            <CheckCircle2 className="size-4 text-success" />
            {simulation?.changedBooks ?? 0} livro(s) com alterações propostas
          </p>
          <p className="mt-1">
            CDD, Cutter, categorias, subtítulo, volume e vínculos administrativos não são alterados.
            A simulação sozinha não conclui a atualização.
          </p>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(reprocessRow)}
        onOpenChange={(open) => {
          if (!open) setReprocessRow(null);
        }}
        title="Reprocessar este livro?"
        description={
          reprocessRow
            ? `O livro "${reprocessRow.title}" já está concluído. A ação explícita consulta novamente a ISBNdb e cria uma nova simulação para revisão antes de aplicar.`
            : undefined
        }
        confirmLabel="Reprocessar"
        loading={busy}
        onConfirm={() => {
          if (reprocessRow) return startSimulation([reprocessRow.bookId]);
        }}
      />

      {drawer && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
            onClick={() => setDrawer(null)}
          />
          <aside className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col bg-surface shadow-[0_0_60px_-12px_rgba(23,26,26,.45)]">
            <div className="flex items-start justify-between gap-3 border-b border-black/8 p-5">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
                  Livro #{drawer.row.bookId}
                </p>
                <h2 className="mt-1 text-lg font-extrabold tracking-tight text-ink">
                  {drawer.row.title}
                </h2>
                <p className="mt-1 text-[12.5px] text-muted">
                  {drawer.row.authors.length > 0
                    ? drawer.row.authors.join(', ')
                    : 'Autor não informado'}
                </p>
              </div>
              <button
                onClick={() => setDrawer(null)}
                className="rounded-control p-2 text-muted transition-colors hover:bg-canvas hover:text-ink"
                aria-label="Fechar detalhes"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              <div className="grid grid-cols-2 gap-3 text-[13px]">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
                    ISBN
                  </p>
                  <p className="mt-1 font-mono text-ink">
                    {drawer.row.isbnUsed ?? drawer.row.isbn13 ?? drawer.row.isbn10 ?? '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
                    Situação
                  </p>
                  <div className="mt-1">
                    <Badge variant={rowBadge(drawer.row).variant}>
                      {rowBadge(drawer.row).label}
                    </Badge>
                  </div>
                </div>
              </div>

              {drawer.source === 'db' ? (
                <>
                  {drawer.row.pendingReason && (
                    <div className="rounded-card bg-warning-soft p-3 text-[12.5px] text-warning">
                      <p className="font-semibold">Por que está pendente</p>
                      <p className="mt-1">{drawer.row.pendingReason}</p>
                    </div>
                  )}

                  {drawer.row.catalogUpdateMessage && (
                    <div className="rounded-card bg-destructive-soft p-3 text-[12.5px] text-destructive">
                      {drawer.row.catalogUpdateMessage}
                    </div>
                  )}

                  <div className="rounded-card hairline p-3 text-[12.5px]">
                    <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
                      Último processamento
                    </p>
                    <dl className="mt-2 grid grid-cols-2 gap-2 text-muted">
                      <div>
                        <dt className="text-[11px] uppercase tracking-wide">Resultado</dt>
                        <dd className="font-semibold text-ink">
                          {drawer.row.processStatus
                            ? PROCESS_BADGE[drawer.row.processStatus]?.label ??
                              drawer.row.processStatus
                            : 'Nunca processado'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] uppercase tracking-wide">Data</dt>
                        <dd className="font-semibold text-ink">
                          {formatDateTime(drawer.row.catalogUpdatedAt)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] uppercase tracking-wide">Origem</dt>
                        <dd className="font-mono text-ink">
                          {drawer.row.catalogUpdateSource ?? '—'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] uppercase tracking-wide">Execução</dt>
                        <dd className="truncate font-mono text-ink">
                          {drawer.row.catalogUpdateJobId ?? '—'}
                        </dd>
                      </div>
                    </dl>
                    {(drawer.row.catalogUpdateFields?.length ?? 0) > 0 && (
                      <div className="mt-3">
                        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
                          Campos gravados
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {drawer.row.catalogUpdateFields?.map((field) => (
                            <Badge key={field} variant="primary">
                              {field}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {drawer.row.rowState === 'UPDATED' && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setReprocessRow(drawer.row);
                        setDrawer(null);
                      }}
                    >
                      <RefreshCw className="size-4" /> Reprocessar este livro
                    </Button>
                  )}
                </>
              ) : (
                <>
                  {drawer.row.reason && (
                    <div className="rounded-card bg-destructive-soft p-3 text-[12.5px] text-destructive">
                      {drawer.row.reason}
                    </div>
                  )}
                  {drawer.row.queryError && (
                    <div className="rounded-card bg-destructive-soft p-3 text-[12.5px] text-destructive">
                      {drawer.row.queryError}
                    </div>
                  )}
                  <div>
                    <h3 className="text-sm font-bold text-ink">Comparativo de campos</h3>
                    {changeCount(drawer.row) === 0 ? (
                      <p className="mt-2 rounded-card bg-canvas p-3 text-[12.5px] text-muted">
                        Nenhuma alteração proposta para este livro.
                      </p>
                    ) : (
                      <div className="mt-2 overflow-hidden rounded-card hairline">
                        <table className="w-full text-left text-[12.5px]">
                          <thead className="bg-surfaceWarm text-[11px] uppercase tracking-[0.08em] text-muted">
                            <tr>
                              <th className="px-3 py-2">Campo</th>
                              <th className="px-3 py-2">Atual</th>
                              <th className="px-3 py-2">Novo</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-black/5">
                            {(drawer.row.changes ?? []).map((change) => (
                              <tr key={change.field}>
                                <td className="px-3 py-2 font-semibold text-ink">{change.label}</td>
                                <td className="px-3 py-2 text-muted">
                                  {valueLabel(change.current)}
                                </td>
                                <td className="px-3 py-2 font-semibold text-primary-dark">
                                  {valueLabel(change.next)}
                                </td>
                              </tr>
                            ))}
                            {drawer.row.authorChanges && (
                              <tr>
                                <td className="px-3 py-2 font-semibold text-ink">Autores</td>
                                <td className="px-3 py-2 text-muted">
                                  {drawer.row.authorChanges.current.join(', ') || '—'}
                                </td>
                                <td className="px-3 py-2 font-semibold text-primary-dark">
                                  {drawer.row.authorChanges.next.join(', ')}
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}