import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
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
import { Skeleton } from '../../../components/ui/skeleton';
import { Textarea } from '../../../components/ui/textarea';
import { categoriesApi } from '../../api';
import { useAsyncData } from '../../hooks/use-async-data';
import { useDebounce } from '../../hooks/use-debounce';
import { useApiToast } from '../../toast/toast-provider';
import { apiErrorMessage } from '../../../lib/errors';
import type { Category } from '../../../types/api';

const schema = z.object({
  name: z.string().min(2, 'Nome é obrigatório'),
  description: z.string(),
});

export function CategoriesPage() {
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 350);
  const [page, setPage] = useState(1);
  const fetcher = () => categoriesApi.list({ search: debounced || undefined, page, pageSize: 25 });
  const { data, error, loading, refetch } = useAsyncData(fetcher, [debounced, page]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [toggling, setToggling] = useState<Category | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useApiToast();

  const { register, handleSubmit, reset, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { name: '', description: '' },
  });

  const openNew = () => {
    setEditing(null);
    reset({ name: '', description: '' });
    setDialogOpen(true);
  };

  const openEdit = (c: Category) => {
    setEditing(c);
    reset({ name: c.name, description: c.description ?? '' });
    setDialogOpen(true);
  };

  const submit = async (v: { name: string; description: string }) => {
    setBusy(true);
    try {
      if (editing) {
        await categoriesApi.update(editing.id, v);
        toast.success('Categoria atualizada');
      } else {
        await categoriesApi.create(v);
        toast.success('Categoria criada');
      }
      setDialogOpen(false);
      refetch();
    } catch (err) {
      toast.error('Não foi possível salvar', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmToggle = async () => {
    if (!toggling) return;
    setBusy(true);
    try {
      if (toggling.status === 'ACTIVE') await categoriesApi.deactivate(toggling.id);
      else await categoriesApi.reactivate(toggling.id);
      toast.success(toggling.status === 'ACTIVE' ? 'Categoria desativada' : 'Categoria reativada');
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
        title="Categorias"
        description={`${data?.total ?? 0} categorias organizando o acervo`}
        actions={<Button onClick={openNew}><Plus className="size-4" /> Nova categoria</Button>}
      />

      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar categoria..."
          className="h-10 w-full rounded-control bg-surface pl-10 pr-3 text-sm text-ink shadow-[inset_0_0_0_1px_rgba(23,26,26,.1)] focus:outline-none focus:shadow-[inset_0_0_0_2px_#087F8C]"
        />
      </div>

      {error ? (
        <Card variant="soft" className="py-12 text-center">
          <p className="text-sm font-semibold text-destructive">{error}</p>
        </Card>
      ) : loading ? (
        <Card className="p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="mb-3 h-14" />
          ))}
        </Card>
      ) : data && data.items.length === 0 ? (
        <Card variant="soft">
          <EmptyState title="Nenhuma categoria" action={<Button size="sm" onClick={openNew}>Criar categoria</Button>} />
        </Card>
      ) : (
        data && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.items.map((c) => (
                <Card key={c.id} className="flex items-center justify-between gap-3 p-5">
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-bold text-ink">{c.name}</p>
                    {c.description && (
                      <p className="mt-0.5 line-clamp-2 text-[12.5px] text-muted">{c.description}</p>
                    )}
                    <p className="mt-1.5 text-[12px] font-semibold text-muted">
                      {c._count?.books ?? 0} livro{c._count?.books === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <Badge variant={c.status === 'ACTIVE' ? 'success' : 'neutral'} dot>
                      {c.status === 'ACTIVE' ? 'Ativa' : 'Inativa'}
                    </Badge>
                    <div className="flex gap-1.5">
                      <Button variant="secondary" size="sm" onClick={() => openEdit(c)}>Editar</Button>
                      <Button
                        variant={c.status === 'ACTIVE' ? 'ghost' : 'secondary'}
                        size="sm"
                        onClick={() => setToggling(c)}
                      >
                        {c.status === 'ACTIVE' ? 'Desativar' : 'Reativar'}
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
            <Pagination page={page} totalPages={data.totalPages} onPageChange={setPage} />
          </>
        )
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader title={editing ? 'Editar categoria' : 'Nova categoria'} />
          <form onSubmit={handleSubmit(submit)}>
            <DialogBody>
              <div>
                <Label>Nome *</Label>
                <Input placeholder="Romance" error={errors.name?.message} {...register('name')} />
              </div>
              <div>
                <Label>Descrição</Label>
                <Textarea rows={3} placeholder="Descreva o escopo da categoria..." {...register('description')} />
              </div>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" loading={busy}>{editing ? 'Salvar' : 'Criar'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!toggling}
        onOpenChange={(o) => !o && setToggling(null)}
        title={toggling?.status === 'ACTIVE' ? 'Desativar categoria' : 'Reativar categoria'}
        description={
          toggling?.status === 'ACTIVE'
            ? `"${toggling?.name}" não poderá ser atribuída a novos livros.`
            : `"${toggling?.name}" voltará a ficar disponível para novos livros.`
        }
        confirmLabel={toggling?.status === 'ACTIVE' ? 'Desativar' : 'Reativar'}
        loading={busy}
        onConfirm={confirmToggle}
      />
    </div>
  );
}
