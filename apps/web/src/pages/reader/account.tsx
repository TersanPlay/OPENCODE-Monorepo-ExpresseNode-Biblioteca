import { useEffect, useRef, useState } from 'react';
import { BookOpen, CalendarClock, FileText, KeyRound, PenLine, UserRound } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { EmptyState } from '../../components/ui/empty-state';
import { Label } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { Skeleton } from '../../components/ui/skeleton';
import { LoanStatusBadge, ReservationStatusBadge } from '../../components/ui/status-badge';
import { TD, TH, TBody, THead, TR, Table } from '../../components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { SignaturePad, type SignaturePadHandle } from '../../features/loans/components/signature-pad';
import { readerPortalApi } from '../../features/readers/portal-api';
import { useReaderSession } from '../../features/readers/reader-session';
import { useAsyncData } from '../../features/hooks/use-async-data';
import { useToast } from '../../features/toast/toast-provider';
import { apiErrorMessage } from '../../lib/errors';
import { formatCPF, formatDate } from '../../lib/format';

export function ReaderAccountPage() {
  const { reader, refresh } = useReaderSession();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const loans = useAsyncData(() => readerPortalApi.myLoans(), [reader?.id]);
  const reservations = useAsyncData(() => readerPortalApi.myReservations(), [reader?.id]);

  const [form, setForm] = useState({ name: '', phone: '', email: '' });
  const [pwd, setPwd] = useState({ currentPassword: '', password: '', confirm: '' });
  const [sigBusy, setSigBusy] = useState(false);
  const [confirmingSigDelete, setConfirmingSigDelete] = useState(false);
  const sigPadRef = useRef<SignaturePadHandle>(null);

  useEffect(() => {
    if (reader) setForm({ name: reader.name, phone: reader.phone ?? '', email: reader.email ?? '' });
  }, [reader?.id]);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await readerPortalApi.updateMe({
        name: form.name,
        phone: form.phone || undefined,
        email: form.email || undefined,
      });
      await refresh();
      toast('success', 'Dados atualizados');
    } catch (err) {
      toast('error', 'Não foi possível salvar', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwd.password !== pwd.confirm) {
      toast('error', 'Senhas não conferem');
      return;
    }
    setBusy(true);
    try {
      await readerPortalApi.changePassword(pwd.currentPassword, pwd.password);
      setPwd({ currentPassword: '', password: '', confirm: '' });
      toast('success', 'Senha alterada');
    } catch (err) {
      toast('error', 'Não foi possível alterar', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const cancelReservation = async (id: number) => {
    setBusy(true);
    try {
      await readerPortalApi.cancelReservation(id);
      reservations.refetch();
      toast('success', 'Reserva cancelada');
    } catch (err) {
      toast('error', 'Não foi possível cancelar', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const saveSignature = async () => {
    const drawn = sigPadRef.current?.toDataURL();
    if (!drawn) {
      toast('error', 'Desenhe a assinatura antes de salvar');
      return;
    }
    setSigBusy(true);
    try {
      await readerPortalApi.setMySignature(drawn);
      sigPadRef.current?.clear();
      await refresh();
      toast('success', 'Assinatura salva');
    } catch (err) {
      toast('error', 'Não foi possível salvar', apiErrorMessage(err));
    } finally {
      setSigBusy(false);
    }
  };

  const deleteSignature = async () => {
    setSigBusy(true);
    try {
      await readerPortalApi.deleteMySignature();
      setConfirmingSigDelete(false);
      await refresh();
      toast('success', 'Assinatura excluída');
    } catch (err) {
      toast('error', 'Não foi possível excluir', apiErrorMessage(err));
    } finally {
      setSigBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="flex items-center gap-2.5 text-2xl font-extrabold tracking-tight text-ink">
          <UserRound className="size-6 text-primary" /> Minha conta
        </h1>
        <p className="mt-1 text-[13.5px] text-muted">
          {reader?.name} · CPF {reader ? formatCPF(reader.cpf) : '—'}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4 text-center">
          <p className="text-2xl font-extrabold text-ink">{loans.data?.activeLoans.length ?? '—'}</p>
          <p className="mt-0.5 text-[12px] font-semibold text-muted">Empréstimos ativos</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-2xl font-extrabold text-destructive">{loans.data?.overdueCount ?? '—'}</p>
          <p className="mt-0.5 text-[12px] font-semibold text-muted">Em atraso</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-2xl font-extrabold text-ink">
            {reservations.data?.filter((r) => r.status === 'PENDING' || r.status === 'AVAILABLE').length ?? '—'}
          </p>
          <p className="mt-0.5 text-[12px] font-semibold text-muted">Reservas ativas</p>
        </Card>
      </div>

      <Card>
        <CardContent className="p-5">
          <Tabs defaultValue="loans">
            <div className="flex justify-center">
              <TabsList>
                <TabsTrigger value="loans" className="inline-flex items-center gap-1.5">
                  <BookOpen className="size-3.5" /> Meus empréstimos
                </TabsTrigger>
                <TabsTrigger value="reservations" className="inline-flex items-center gap-1.5">
                  <CalendarClock className="size-3.5" /> Minhas reservas
                </TabsTrigger>
                <TabsTrigger value="profile">Meus dados</TabsTrigger>
                <TabsTrigger value="signature" className="inline-flex items-center gap-1.5">
                  <PenLine className="size-3.5" /> Assinatura
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="loans">
              {loans.loading ? (
                <Skeleton className="h-32" />
              ) : loans.data && loans.data.loans.length > 0 ? (
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
                    {loans.data.loans.map((l) => (
                      <TR key={l.id}>
                        <TD className="max-w-56 truncate font-semibold text-ink">{l.book?.title}</TD>
                        <TD className="text-muted">{formatDate(l.loanDate)}</TD>
                        <TD className="text-muted">{formatDate(l.dueDate)}</TD>
                        <TD className="text-muted">{l.returnedAt ? formatDate(l.returnedAt) : '—'}</TD>
                        <TD><LoanStatusBadge status={l.status} /></TD>
                        <TD className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="sm" variant="secondary" title="Termo de Empréstimo" onClick={() => readerPortalApi.openTerm(l.id)}>
                              <FileText className="size-3.5" />
                            </Button>
                            {l.returnedAt && (
                              <Button size="sm" variant="secondary" title="Termo de Devolução" onClick={() => readerPortalApi.openReturnTerm(l.id)}>
                                <FileText className="size-3.5 text-success" />
                              </Button>
                            )}
                          </div>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <EmptyState compact title="Nenhum empréstimo" description="Retire livros no balcão com seu cadastro." />
              )}
            </TabsContent>

            <TabsContent value="reservations">
              {reservations.loading ? (
                <Skeleton className="h-32" />
              ) : reservations.data && reservations.data.length > 0 ? (
                <Table>
                  <THead>
                    <TR>
                      <TH>Livro</TH>
                      <TH>Solicitada em</TH>
                      <TH>Expira em</TH>
                      <TH>Status</TH>
                      <TH className="text-right">Ações</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {reservations.data.map((r) => (
                      <TR key={r.id}>
                        <TD className="max-w-56 truncate font-semibold text-ink">{r.book?.title}</TD>
                        <TD className="text-muted">{formatDate(r.createdAt)}</TD>
                        <TD className="text-muted">{r.expiresAt ? formatDate(r.expiresAt) : '—'}</TD>
                        <TD><ReservationStatusBadge status={r.status} /></TD>
                        <TD className="text-right">
                          {(r.status === 'PENDING' || r.status === 'AVAILABLE') && (
                            <Button size="sm" variant="ghost" loading={busy} onClick={() => cancelReservation(r.id)}>
                              Cancelar
                            </Button>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <EmptyState compact title="Nenhuma reserva" description="Reserve livros pelo catálogo." />
              )}
            </TabsContent>

            <TabsContent value="profile">
              <div className="grid gap-6 lg:grid-cols-2">
                <form onSubmit={saveProfile} className="space-y-4">
                  <div>
                    <Label htmlFor="p-name">Nome completo</Label>
                    <Input id="p-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="p-email">E-mail (login)</Label>
                    <Input id="p-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="p-phone">Telefone</Label>
                    <Input id="p-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                  </div>
                  <Button type="submit" loading={busy}>Salvar dados</Button>
                </form>
                <form onSubmit={savePassword} className="space-y-4">
                  <div>
                    <Label htmlFor="p-current">Senha atual</Label>
                    <Input id="p-current" type="password" value={pwd.currentPassword} onChange={(e) => setPwd({ ...pwd, currentPassword: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="p-new">Nova senha</Label>
                    <Input id="p-new" type="password" placeholder="Mínimo 6 caracteres" value={pwd.password} onChange={(e) => setPwd({ ...pwd, password: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="p-confirm">Confirmar nova senha</Label>
                    <Input id="p-confirm" type="password" value={pwd.confirm} onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })} />
                  </div>
                  <Button type="submit" loading={busy} variant="secondary">
                    <KeyRound className="size-4" /> Alterar senha
                  </Button>
                </form>
              </div>
            </TabsContent>

            <TabsContent value="signature" className="space-y-4">
              {reader?.signature ? (
                <div>
                  <Label>Assinatura atual</Label>
                  <img
                    src={reader.signature}
                    alt="Assinatura atual"
                    className="mt-1 h-24 w-full rounded-small border border-black/10 bg-white object-contain"
                  />
                </div>
              ) : (
                <p className="rounded-card bg-surfaceBlue2 px-4 py-3 text-[12.5px] text-primary-dark">
                  Nenhuma assinatura registrada. Desenhe abaixo para cadastrar.
                </p>
              )}
              <SignaturePad
                ref={sigPadRef}
                label="Editar assinatura"
                hint="Assine e clique em Salvar para substituir a atual."
              />
              <div className="flex flex-wrap gap-2">
                <Button onClick={saveSignature} loading={sigBusy}>
                  <PenLine className="size-4" /> Salvar assinatura
                </Button>
                {reader?.signature && (
                  <Button variant="ghost" loading={sigBusy} onClick={() => setConfirmingSigDelete(true)}>
                    Excluir assinatura
                  </Button>
                )}
              </div>
              <p className="text-[12px] text-muted">
                A alteração atinge apenas a assinatura do seu perfil. Termos de empréstimos e
                devoluções já assinados permanecem inalterados.
              </p>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmingSigDelete}
        onOpenChange={setConfirmingSigDelete}
        title="Excluir assinatura"
        description="Sua assinatura atual será removida do perfil. Você poderá desenhar uma nova depois. Termos já assinados não são afetados."
        confirmLabel="Excluir"
        destructive
        onConfirm={deleteSignature}
      />
    </div>
  );
}
