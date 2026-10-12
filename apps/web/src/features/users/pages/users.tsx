import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PenLine, Plus, Search, UserCog } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { ConfirmDialog } from '../../../components/ui/confirm-dialog';
import {
  Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader,
} from '../../../components/ui/dialog';
import { EmptyState } from '../../../components/ui/empty-state';
import { Label } from '../../../components/ui/form-field';
import { Input } from '../../../components/ui/input';
import { PageHeader } from '../../../components/ui/page-header';
import { Pagination } from '../../../components/ui/pagination';
import { Select } from '../../../components/ui/select';
import { Skeleton } from '../../../components/ui/skeleton';
import { UserStatusBadge } from '../../../components/ui/status-badge';
import { TD, TH, TBody, THead, TR, Table } from '../../../components/ui/table';
import { usersApi } from '../../api';
import {
  AppearanceEditor,
  type AppearanceEditorHandle,
} from '../../signature/appearance-editor';
import { useAsyncData } from '../../hooks/use-async-data';
import { useDebounce } from '../../hooks/use-debounce';
import { useAuth } from '../../auth/auth-provider';
import { useApiToast } from '../../toast/toast-provider';
import { apiErrorMessage } from '../../../lib/errors';
import { formatDate } from '../../../lib/format';
import type { User } from '../../../types/api';

const schema = z.object({
  name: z.string().min(2, 'Nome é obrigatório'),
  email: z.string().email('E-mail inválido'),
  password: z.string().min(6, 'Mínimo de 6 caracteres'),
  role: z.enum(['ADMIN', 'ATTENDANT']),
});

export function UsersPage() {
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 350);
  const [page, setPage] = useState(1);
  const fetcher = () => usersApi.list({ search: debounced || undefined, page, pageSize: 12 });
  const { data, error, loading, refetch } = useAsyncData(fetcher, [debounced, page]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [toggling, setToggling] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const [sigUser, setSigUser] = useState<User | null>(null);
  const [sigBusy, setSigBusy] = useState(false);
  const [sigLoading, setSigLoading] = useState(false);
  const sigEditorRef = useRef<AppearanceEditorHandle>(null);
  const { toast } = useApiToast();
  const { user: me } = useAuth();

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', password: '', role: 'ATTENDANT' },
  });

  const openNew = () => {
    setEditing(null);
    reset({ name: '', email: '', password: '', role: 'ATTENDANT' });
    setDialogOpen(true);
  };

  const openEdit = (u: User) => {
    setEditing(u);
    reset({ name: u.name, email: u.email, password: '', role: u.role });
    setDialogOpen(true);
  };

  // A listagem não traz as imagens da assinatura (PNG em base64): buscamos o
  // usuário completo só ao abrir o editor.
  const openSignature = async (u: User) => {
    setSigLoading(true);
    try {
      setSigUser(await usersApi.get(u.id));
    } catch {
      toast.error('Não foi possível carregar a assinatura.');
    } finally {
      setSigLoading(false);
    }
  };

  const submit = async (v: z.infer<typeof schema>) => {
    setBusy(true);
    try {
      if (editing) {
        await usersApi.update(editing.id, {
          name: v.name,
          email: v.email,
          role: v.role,
          password: v.password || undefined,
        });
        toast.success('Usuário atualizado');
      } else {
        await usersApi.create(v);
        toast.success('Usuário criado');
      }
      setDialogOpen(false);
      refetch();
    } catch (err) {
      toast.error('Não foi possível salvar', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const saveSignature = async () => {
    if (!sigUser) return;
    const value = await sigEditorRef.current?.resolve();
    if (!value) return;
    setSigBusy(true);
    try {
      const updated = await usersApi.setSignature(sigUser.id, value);
      setSigUser({ ...sigUser, ...updated });
      toast.success('Assinatura salva');
      refetch();
    } catch (err) {
      toast.error('Não foi possível salvar', apiErrorMessage(err));
    } finally {
      setSigBusy(false);
    }
  };

  const removeSignature = async () => {
    if (!sigUser?.signature) return;
    setSigBusy(true);
    try {
      await usersApi.setSignature(sigUser.id, { signature: null });
      setSigUser({
        ...sigUser,
        signature: null,
        signatureType: null,
        signatureText: null,
        rubricText: null,
        rubricImage: null,
        fontFamily: null,
      });
      toast.success('Assinatura removida');
      refetch();
    } catch (err) {
      toast.error('Não foi possível remover', apiErrorMessage(err));
    } finally {
      setSigBusy(false);
    }
  };

  const confirmToggle = async () => {
    if (!toggling) return;
    setBusy(true);
    try {
      if (toggling.status === 'ACTIVE') await usersApi.deactivate(toggling.id);
      else await usersApi.reactivate(toggling.id);
      toast.success(toggling.status === 'ACTIVE' ? 'Usuário desativado' : 'Usuário reativado');
      setToggling(null);
      refetch();
    } catch (err) {
      toast.error('Não foi possível concluir', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Usuários do sistema"
        description={`${data?.total ?? 0} contas da equipe`}
        actions={<Button onClick={openNew}><Plus className="size-4" /> Novo usuário</Button>}
      />

      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nome ou e-mail..."
          className="h-10 w-full rounded-control bg-surface pl-10 pr-3 text-sm text-ink shadow-[inset_0_0_0_1px_rgba(23,26,26,.1)] focus:outline-none focus:shadow-[inset_0_0_0_2px_#087F8C]"
        />
      </div>

      {error ? (
        <Card variant="soft" className="py-12 text-center">
          <p className="text-sm font-semibold text-destructive">{error}</p>
        </Card>
      ) : loading ? (
        <Card className="p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="mb-3 h-12" />
          ))}
        </Card>
      ) : data && data.items.length === 0 ? (
        <Card variant="soft">
          <EmptyState title="Nenhum usuário encontrado" action={<Button size="sm" onClick={openNew}>Criar usuário</Button>} />
        </Card>
      ) : (
        data && (
          <>
            <Card className="overflow-hidden p-0">
              <Table>
                <THead>
                  <TR>
                    <TH>Usuário</TH>
                    <TH>Papel</TH>
                    <TH>Criado em</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Ações</TH>
                  </TR>
                </THead>
                <TBody>
                  {data.items.map((u) => (
                    <TR key={u.id}>
                      <TD>
                        <p className="font-bold text-ink">
                          <Link to={`/admin/usuarios/${u.id}`} className="hover:text-primary">
                            {u.name}
                          </Link>
                          {u.id === me?.id && <span className="ml-2 text-[11px] font-semibold text-primary">(você)</span>}
                        </p>
                        <p className="font-mono text-[12px] text-muted">{u.email}</p>
                      </TD>
                      <TD>
                        <Badge variant={u.role === 'ADMIN' ? 'primary' : 'neutral'}>
                          {u.role === 'ADMIN' ? 'Administrador' : 'Atendente'}
                        </Badge>
                      </TD>
                      <TD className="text-muted">{formatDate(u.createdAt)}</TD>
                      <TD><UserStatusBadge status={u.status} /></TD>
                      <TD className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button variant="secondary" size="sm" onClick={() => openEdit(u)}>
                            Editar
                          </Button>
                          <Button variant="secondary" size="sm" title="Gerenciar assinatura digital" onClick={() => openSignature(u)}>
                            <PenLine className="size-3.5" /> Assinatura
                          </Button>
                          {u.id !== me?.id && (
                            <Button
                              variant={u.status === 'ACTIVE' ? 'ghost' : 'secondary'}
                              size="sm"
                              onClick={() => setToggling(u)}
                            >
                              {u.status === 'ACTIVE' ? 'Desativar' : 'Reativar'}
                            </Button>
                          )}
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
            <Pagination page={page} totalPages={data.totalPages} onPageChange={setPage} />
          </>
        )
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader title={editing ? 'Editar usuário' : 'Novo usuário'} />
          <form onSubmit={handleSubmit(submit)}>
            <DialogBody>
              <div>
                <Label>Nome *</Label>
                <Input placeholder="Nome da pessoa" error={errors.name?.message} {...register('name')} />
              </div>
              <div>
                <Label>E-mail *</Label>
                <Input type="email" placeholder="pessoa@biblioteca.local" error={errors.email?.message} {...register('email')} />
              </div>
              <div>
                <Label>{editing ? 'Nova senha (opcional)' : 'Senha *'}</Label>
                <Input
                  type="password"
                  placeholder={editing ? 'Deixe em branco para manter' : 'Mínimo 6 caracteres'}
                  error={errors.password?.message}
                  {...register('password')}
                />
              </div>
              <div>
                <Label>Papel</Label>
                <Select
                  value={watch('role')}
                  onValueChange={(v) => setValue('role', v as 'ADMIN' | 'ATTENDANT')}
                  options={[
                    { value: 'ADMIN', label: 'Administrador — acesso total' },
                    { value: 'ATTENDANT', label: 'Atendente — operação diária' },
                  ]}
                />
                <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-muted">
                  <UserCog className="size-3.5" /> Atendentes não acessam autoria, categorias, relatórios, usuários nem configurações.
                </p>
              </div>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" loading={busy}>{editing ? 'Salvar' : 'Criar usuário'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!sigUser || sigLoading} onOpenChange={(o) => !o && setSigUser(null)}>
        <DialogContent>
          <DialogHeader
            title="Assinatura digital"
            description={sigUser ? `${sigUser.name} · ${sigUser.email}` : undefined}
          />
          <DialogBody>
            {sigLoading && !sigUser ? (
              <p className="mb-4 rounded-card bg-surfaceBlue2 px-4 py-3 text-[12.5px] text-primary-dark">
                Carregando assinatura…
              </p>
            ) : sigUser?.signature ? (
              <div className="mb-4">
                <Label>Assinatura salva</Label>
                <img src={sigUser.signature} alt="Assinatura salva" className="mt-1 aspect-[13/4] w-full rounded-small border border-black/10 bg-white object-contain" />
                {sigUser.rubricImage && (
                  <img src={sigUser.rubricImage} alt="Rubrica salva" className="mt-2 h-12 w-28 rounded-small border border-black/10 bg-white object-contain" />
                )}
              </div>
            ) : (
              <p className="mb-4 rounded-card bg-surfaceBlue2 px-4 py-3 text-[12.5px] text-primary-dark">
                Nenhuma assinatura salva. Crie abaixo para cadastrar.
              </p>
            )}
            <AppearanceEditor
              ref={sigEditorRef}
              initial={
                sigUser?.signature
                  ? {
                      signature: sigUser.signature,
                      signatureType: sigUser.signatureType,
                      signatureText: sigUser.signatureText,
                      rubricText: sigUser.rubricText,
                      rubricImage: sigUser.rubricImage,
                      fontFamily: sigUser.fontFamily,
                    }
                  : null
              }
            />
          </DialogBody>
          <DialogFooter>
            {sigUser?.signature && (
              <Button type="button" variant="ghost" loading={sigBusy} onClick={removeSignature}>
                Remover salva
              </Button>
            )}
            <div className="ml-auto flex gap-2">
              <Button type="button" variant="secondary" onClick={() => setSigUser(null)}>Fechar</Button>
              <Button type="button" loading={sigBusy} onClick={saveSignature}>
                <PenLine className="size-4" /> Salvar assinatura
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!toggling}
        onOpenChange={(o) => !o && setToggling(null)}
        title={toggling?.status === 'ACTIVE' ? 'Desativar usuário' : 'Reativar usuário'}
        description={
          toggling?.status === 'ACTIVE'
            ? `${toggling?.name} perderá o acesso ao sistema imediatamente.`
            : `${toggling?.name} voltará a acessar o sistema.`
        }
        confirmLabel={toggling?.status === 'ACTIVE' ? 'Desativar' : 'Reativar'}
        destructive={toggling?.status === 'ACTIVE'}
        loading={busy}
        onConfirm={confirmToggle}
      />
    </div>
  );
}