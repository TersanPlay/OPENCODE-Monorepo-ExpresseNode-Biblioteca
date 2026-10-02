import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, CheckCircle2, FileText, KeyRound, Mail, MapPin, Pencil, Phone, UserCheck, UserRound, UserX } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Select } from '../../../components/ui/select';
import { Card, CardContent } from '../../../components/ui/card';
import { ConfirmDialog } from '../../../components/ui/confirm-dialog';
import { EmptyState } from '../../../components/ui/empty-state';
import { Pagination } from '../../../components/ui/pagination';
import { PageSkeleton } from '../../../components/ui/skeleton';
import { ReservationStatusBadge, LoanStatusBadge, ReaderStatusBadge } from '../../../components/ui/status-badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../components/ui/tabs';
import { TD, TH, THead, TR, Table, TBody } from '../../../components/ui/table';
import { loansApi, readersApi } from '../../api';
import { useAsyncData } from '../../hooks/use-async-data';
import { useApiToast } from '../../toast/toast-provider';
import { apiErrorMessage } from '../../../lib/errors';
import { formatCPF, formatDate, formatPhone } from '../../../lib/format';
import { ReaderFormDialog } from './reader-form-dialog';

type ConfirmKind = 'none' | 'block' | 'unblock' | 'deactivate' | 'activate' | 'delete' | 'password';

const CONFIRM_TEXTS = {
  block: { title: 'Bloquear leitor', label: 'Bloquear', destructive: true },
  unblock: { title: 'Desbloquear leitor', label: 'Desbloquear', destructive: false },
  deactivate: {
    title: 'Desativar leitor',
    label: 'Desativar',
    destructive: true,
  },
  activate: { title: 'Ativar leitor', label: 'Ativar', destructive: false },
  password: { title: 'Definir senha de acesso', label: 'Salvar senha', destructive: false },
} as const;

const DELETE_PHRASE = 'EXCLUIR';

export function ReaderDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const readerId = Number(id);
  const fetcher = useCallback(() => readersApi.get(readerId), [readerId]);
  const { data, error, loading, refetch } = useAsyncData(fetcher, [readerId]);
  const [confirming, setConfirming] = useState<{ kind: ConfirmKind }>({ kind: 'none' });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blockCategory, setBlockCategory] = useState<string>('ATRASO_REPETIDO');
  const [blockReason, setBlockReason] = useState('');
  const [deletePhrase, setDeletePhrase] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [loansPage, setLoansPage] = useState(1);
  const [resPage, setResPage] = useState(1);

  useEffect(() => {
    setLoansPage(1);
    setResPage(1);
  }, [readerId]);
  const { toast } = useApiToast();
  const navigate = useNavigate();

  if (loading) return <PageSkeleton />;

  if (error || !data) {
    return (
      <Card variant="soft" className="py-14 text-center">
        <p className="text-sm font-semibold text-destructive">{error ?? 'Leitor não encontrado.'}</p>
        <Link to="/admin/leitores">
          <Button variant="secondary" size="sm" className="mt-3">Voltar</Button>
        </Link>
      </Card>
    );
  }

  const { reader } = data;

  const PAGE_SIZE = 10;
  const loansTotalPages = Math.max(1, Math.ceil(data.loans.length / PAGE_SIZE));
  const resTotalPages = Math.max(1, Math.ceil(data.reservations.length / PAGE_SIZE));
  const loansPageSafe = Math.min(loansPage, loansTotalPages);
  const resPageSafe = Math.min(resPage, resTotalPages);
  const loansShown = data.loans.slice((loansPageSafe - 1) * PAGE_SIZE, loansPageSafe * PAGE_SIZE);
  const resShown = data.reservations.slice((resPageSafe - 1) * PAGE_SIZE, resPageSafe * PAGE_SIZE);

  const toggleBlock = async () => {
    setBusy(true);
    try {
      if (reader.status === 'BLOCKED') await readersApi.unblock(reader.id);
      else await readersApi.block(reader.id, blockReason || undefined, blockCategory || undefined);
      toast.success(reader.status === 'BLOCKED' ? 'Leitor desbloqueado' : 'Leitor bloqueado');
      setConfirming({ kind: 'none' });
      setBlockReason('');
      setBlockCategory('ATRASO_REPETIDO');
      refetch();
    } catch (err) {
      toast.error('Não foi possível concluir', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleStatus = async () => {
    if (!reader) return;
    setBusy(true);
    try {
      const next = reader.status === 'INACTIVE' ? 'ACTIVE' : 'INACTIVE';
      await readersApi.setStatus(reader.id, next);
      toast.success(next === 'ACTIVE' ? 'Leitor ativado' : 'Leitor desativado');
      setConfirming({ kind: 'none' });
      refetch();
    } catch (err) {
      toast.error('Não foi possível concluir', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const saveReaderPassword = async () => {
    if (!reader || newPassword.length < 6 || newPassword !== newPasswordConfirm) return;
    setBusy(true);
    try {
      await readersApi.setReaderPassword(reader.id, newPassword);
      toast.success('Senha de acesso definida', `${reader.name} já pode entrar no portal`);
      setConfirming({ kind: 'none' });
      setNewPassword('');
      setNewPasswordConfirm('');
      refetch();
    } catch (err) {
      toast.error('Não foi possível salvar', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const deleteReader = async () => {
    if (!reader) return;
    setBusy(true);
    try {
      await readersApi.remove(reader.id, deleteReason || undefined);
      toast.success('Leitor excluído permanentemente');
      setConfirming({ kind: 'none' });
      navigate('/admin/leitores');
    } catch (err) {
      toast.error('Não foi possível excluir', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const contact = [
    { icon: Mail, label: 'E-mail', value: reader.email },
    { icon: Phone, label: 'Telefone', value: reader.phone ? formatPhone(reader.phone) : null },
    { icon: UserRound, label: 'Nascimento', value: reader.birthDate ? formatDate(reader.birthDate) : null },
    { icon: MapPin, label: 'Endereço', value: [reader.address, reader.number, reader.neighborhood, reader.city, reader.state].filter(Boolean).join(', ') || null },
  ].filter((c) => c.value);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/admin/leitores"
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary transition-colors hover:text-primary-dark"
        >
          <ArrowLeft className="size-4" /> Leitores
        </Link>
      </div>

      <Card className="p-6">
        <div className="flex flex-wrap items-center gap-5">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-shell bg-primary-soft text-xl font-extrabold text-primary-dark">
            {reader.name.split(' ').slice(0, 2).map((p) => p[0]).join('')}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-extrabold tracking-tight text-ink">{reader.name}</h1>
              {reader.deletedAt ? (
                <Badge variant="neutral">Excluído</Badge>
              ) : (
                <ReaderStatusBadge status={reader.status} />
              )}
            </div>
            <p className="mt-1 font-mono text-[13px] text-muted">{formatCPF(reader.cpf)}</p>
          </div>
          {!reader.deletedAt && (
            <div className="flex items-center gap-2">
              <Link to="/admin/emprestimos/novo">
                <Button disabled={reader.status !== 'ACTIVE'} title={reader.status !== 'ACTIVE' ? 'Leitor bloqueado ou inativo não pode realizar empréstimos' : undefined}>
                  Novo empréstimo
                </Button>
              </Link>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil className="size-4" /> Editar
              </Button>
              <Button
                variant="secondary"
                title="Define a senha que o leitor usa para entrar no portal (/login)"
                onClick={() => { setNewPassword(''); setNewPasswordConfirm(''); setConfirming({ kind: 'password' }); }}
              >
                <KeyRound className="size-4" /> Senha de acesso
              </Button>
              {reader.status === 'BLOCKED' ? (
                <Button variant="secondary" onClick={() => setConfirming({ kind: 'unblock' })}>
                  <CheckCircle2 className="size-4 text-success" /> Desbloquear
                </Button>
              ) : reader.status === 'ACTIVE' ? (
                <Button variant="secondary" onClick={() => setConfirming({ kind: 'block' })}>
                  <Ban className="size-4 text-destructive" /> Bloquear
                </Button>
              ) : null}
              {reader.status === 'INACTIVE' ? (
                <Button variant="secondary" onClick={() => setConfirming({ kind: 'activate' })}>
                  <UserCheck className="size-4 text-success" /> Ativar
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => setConfirming({ kind: 'deactivate' })}>
                  <UserX className="size-4 text-destructive" /> Desativar
                </Button>
              )}
            </div>
          )}
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {contact.map((c) => (
            <div key={c.label} className="flex items-center gap-3 rounded-card bg-surfaceBlue2 px-4 py-3">
              <c.icon className="size-4 shrink-0 text-primary" />
              <span className="min-w-0">
                <span className="block text-[11px] font-bold uppercase tracking-wide text-muted">{c.label}</span>
                <span className="block truncate text-[13px] font-semibold text-ink">{c.value}</span>
              </span>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4 text-center">
          <p className="text-2xl font-extrabold text-primary">{data.activeLoans.length}</p>
          <p className="mt-0.5 text-[12px] font-semibold text-muted">Empréstimos ativos</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-2xl font-extrabold text-destructive">{data.overdueCount}</p>
          <p className="mt-0.5 text-[12px] font-semibold text-muted">Em atraso</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-2xl font-extrabold text-ink">{data.reservations.filter((r) => r.status === 'PENDING').length}</p>
          <p className="mt-0.5 text-[12px] font-semibold text-muted">Reservas pendentes</p>
        </Card>
      </div>

      <Card>
        <CardContent className="p-5">
          <Tabs defaultValue="loans">
            <TabsList>
              <TabsTrigger value="loans">Histórico de empréstimos ({data.loans.length})</TabsTrigger>
              <TabsTrigger value="reservations">Reservas ({data.reservations.length})</TabsTrigger>
              <TabsTrigger value="signature">Assinatura</TabsTrigger>
            </TabsList>
            <TabsContent value="loans">
              {data.loans.length === 0 ? (
                <EmptyState compact title="Nenhum empréstimo ainda" />
              ) : (
                <>
                <Table>
                  <THead>
                    <TR>
                      <TH>Livro</TH>
                      <TH>Emprestado em</TH>
                      <TH>Vencimento</TH>
                      <TH>Devolução</TH>
                      <TH>Status</TH>
                      <TH className="text-right">Documentos</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {loansShown.map((l) => (
                      <TR key={l.id}>
                        <TD className="max-w-56 truncate font-semibold text-ink">{l.book?.title}</TD>
                        <TD className="text-muted">{formatDate(l.loanDate)}</TD>
                        <TD className="text-muted">{formatDate(l.dueDate)}</TD>
                        <TD className="text-muted">{l.returnedAt ? formatDate(l.returnedAt) : '—'}</TD>
                        <TD><LoanStatusBadge status={l.status} /></TD>
                        <TD className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="secondary"
                              title="Termo de Empréstimo"
                              onClick={() => loansApi.openTerm(l.id)}
                            >
                              <FileText className="size-3.5" />
                            </Button>
                            {l.returnedAt && (
                              <Button
                                size="sm"
                                variant="secondary"
                                title="Termo de Devolução"
                                onClick={() => loansApi.openReturnTerm(l.id)}
                              >
                                <FileText className="size-3.5 text-success" />
                              </Button>
                            )}
                          </div>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
                <Pagination className="mt-4" page={loansPageSafe} totalPages={loansTotalPages} onPageChange={setLoansPage} />
                </>
              )}
            </TabsContent>
            <TabsContent value="reservations">
              {data.reservations.length === 0 ? (
                <EmptyState compact title="Nenhuma reserva" />
              ) : (
                <>
                <Table>
                  <THead>
                    <TR>
                      <TH>Livro</TH>
                      <TH>Solicitada em</TH>
                      <TH>Expira em</TH>
                      <TH>Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {resShown.map((r) => (
                      <TR key={r.id}>
                        <TD className="max-w-56 truncate font-semibold text-ink">{r.book?.title}</TD>
                        <TD className="text-muted">{formatDate(r.createdAt)}</TD>
                        <TD className="text-muted">{r.expiresAt ? formatDate(r.expiresAt) : '—'}</TD>
                        <TD><ReservationStatusBadge status={r.status} /></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
                <Pagination className="mt-4" page={resPageSafe} totalPages={resTotalPages} onPageChange={setResPage} />
                </>
              )}
            </TabsContent>
            <TabsContent value="signature">
              {data.reader.signature ? (
                <div className="max-w-md">
                  <img
                    src={data.reader.signature}
                    alt={`Assinatura de ${data.reader.name}`}
                    className="h-28 w-full rounded-small border border-black/10 bg-white object-contain"
                  />
                  {data.reader.signatureUpdatedAt && (
                    <p className="mt-2 text-[12px] text-muted">
                      Registrada em {formatDate(data.reader.signatureUpdatedAt)}
                    </p>
                  )}
                </div>
              ) : (
                <EmptyState compact title="Nenhuma assinatura registrada" description="Este leitor ainda não possui assinatura no cadastro." />
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <ReaderFormDialog
        open={editing}
        onOpenChange={setEditing}
        reader={reader}
        onSaved={() => refetch()}
      />

      {!reader.deletedAt && (
        <div className="rounded-card border border-destructive/25 bg-[#FDF4F3] p-5">
          <h2 className="text-[15px] font-extrabold text-destructive">Zona de perigo</h2>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13.5px] font-bold text-ink">Excluir leitor permanentemente</p>
              <p className="mt-0.5 max-w-2xl text-[12.5px] leading-relaxed text-muted">
                Os dados cadastrais deste leitor serão excluídos. Empréstimos, devoluções, reservas,
                multas e demais registros históricos serão preservados para fins administrativos,
                estatísticos, de auditoria e relatórios.
              </p>
            </div>
            <Button variant="secondary" onClick={() => setConfirming({ kind: 'delete' })}>
              <UserX className="size-4 text-destructive" /> Excluir leitor
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirming.kind !== 'none'}
        onOpenChange={(o) => {
          if (!o) {
            setConfirming({ kind: 'none' });
            setDeletePhrase('');
            setDeleteReason('');
            setNewPassword('');
            setNewPasswordConfirm('');
          }
        }}
        title={
          confirming.kind === 'delete'
            ? 'Excluir leitor permanentemente'
            : confirming.kind !== 'none'
              ? CONFIRM_TEXTS[confirming.kind].title
              : ''
        }
        description={
          confirming.kind === 'block'
            ? `${reader.name} não poderá realizar novos empréstimos até ser desbloqueado.`
            : confirming.kind === 'unblock'
              ? `${reader.name} voltará a poder realizar empréstimos.`
              : confirming.kind === 'deactivate'
                ? `${reader.name} ficará inativo e não poderá realizar novos empréstimos. O histórico será preservado.`
                : confirming.kind === 'activate'
                  ? `${reader.name} voltará ao status ativo e poderá realizar empréstimos.`
                  : confirming.kind === 'password'
                    ? `${reader.name} poderá entrar no portal do leitor (/login) com o e-mail ${reader.email ?? 'cadastrado'} e a nova senha.`
                    : 'Esta ação é permanente e não pode ser desfeita.'
        }
        confirmLabel={
          confirming.kind === 'delete'
            ? 'Excluir permanentemente'
            : confirming.kind !== 'none'
              ? CONFIRM_TEXTS[confirming.kind].label
              : ''
        }
        destructive={confirming.kind !== 'none' && (confirming.kind === 'delete' || CONFIRM_TEXTS[confirming.kind].destructive)}
        loading={busy}
        onConfirm={
          confirming.kind === 'block' || confirming.kind === 'unblock'
            ? toggleBlock
            : confirming.kind === 'delete'
              ? deleteReader
              : confirming.kind === 'password'
                ? saveReaderPassword
                : toggleStatus
        }
        confirmDisabled={
          confirming.kind === 'delete'
            ? deletePhrase.trim().toUpperCase() !== DELETE_PHRASE
            : confirming.kind === 'password'
              ? newPassword.length < 6 || newPassword !== newPasswordConfirm
              : undefined
        }
      >
        {confirming.kind === 'block' && (
          <div className="space-y-3 py-2">
            <div>
              <label className="mb-1 block text-[12px] font-bold text-muted">Motivo</label>
              <Select
                value={blockCategory}
                onValueChange={setBlockCategory}
                options={[
                  { value: 'ATRASO_REPETIDO', label: 'Atraso repetido' },
                  { value: 'COMPORTAMENTO', label: 'Comportamento inadequado' },
                  { value: 'SOLICITACAO', label: 'Solicitação administrativa' },
                  { value: 'OUTRO', label: 'Outro' },
                ]}
              />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-bold text-muted">Detalhes (opcional)</label>
              <textarea
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                placeholder="Descreva o motivo do bloqueio..."
                rows={3}
                className="w-full rounded-control bg-surface px-3 py-2 text-sm text-ink shadow-[inset_0_0_0_1px_rgba(23,26,26,.1)] focus:outline-none focus:shadow-[inset_0_0_0_2px_#087F8C]"
              />
            </div>
          </div>
        )}
        {confirming.kind === 'password' && (
          <div className="space-y-3 py-2">
            <div>
              <label className="mb-1 block text-[12px] font-bold text-muted">Nova senha (mínimo 6 caracteres)</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                className="h-9 w-full rounded-control bg-surface px-3 text-sm text-ink shadow-[inset_0_0_0_1px_rgba(23,26,26,.1)] focus:outline-none focus:shadow-[inset_0_0_0_2px_#087F8C]"
              />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-bold text-muted">Confirmar senha</label>
              <input
                type="password"
                value={newPasswordConfirm}
                onChange={(e) => setNewPasswordConfirm(e.target.value)}
                placeholder="Repita a senha"
                autoComplete="new-password"
                className="h-9 w-full rounded-control bg-surface px-3 text-sm text-ink shadow-[inset_0_0_0_1px_rgba(23,26,26,.1)] focus:outline-none focus:shadow-[inset_0_0_0_2px_#087F8C]"
              />
            </div>
            {newPassword && newPasswordConfirm && newPassword !== newPasswordConfirm && (
              <p className="text-[12px] font-semibold text-destructive">Senhas não conferem.</p>
            )}
          </div>
        )}
        {confirming.kind === 'delete' && (
          <div className="space-y-4 py-2">
            <ul className="space-y-1 rounded-card bg-surfaceWarm p-3 text-[12.5px] leading-relaxed text-muted">
              <li>• Nome, CPF, contato e endereço serão removidos de forma irreversível.</li>
              <li>• Empréstimos, devoluções, reservas canceladas e registros históricos serão preservados.</li>
              <li>• A exclusão ficará registrada na auditoria com sua conta e a referência histórica do leitor.</li>
            </ul>
            <div>
              <label className="mb-1 block text-[12px] font-bold text-muted">Motivo (opcional)</label>
              <textarea
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="Motivo administrativo, legal ou jurídico..."
                rows={2}
                className="w-full rounded-control bg-surface px-3 py-2 text-sm text-ink shadow-[inset_0_0_0_1px_rgba(23,26,26,.1)] focus:outline-none focus:shadow-[inset_0_0_0_2px_#087F8C]"
              />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-bold text-destructive">
                Digite <span className="font-mono">{DELETE_PHRASE}</span> para confirmar
              </label>
              <input
                value={deletePhrase}
                onChange={(e) => setDeletePhrase(e.target.value)}
                placeholder={DELETE_PHRASE}
                className="h-9 w-full rounded-control bg-surface px-3 text-sm text-ink shadow-[inset_0_0_0_1px_rgba(23,26,26,.1)] focus:outline-none focus:shadow-[inset_0_0_0_2px_#C03A2B]"
              />
            </div>
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}