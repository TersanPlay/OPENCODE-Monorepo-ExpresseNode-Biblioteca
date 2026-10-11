import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, PenLine } from 'lucide-react';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Label } from '../../../components/ui/form-field';
import { PageSkeleton } from '../../../components/ui/skeleton';
import { UserStatusBadge } from '../../../components/ui/status-badge';
import {
  AppearanceEditor,
  type AppearanceEditorHandle,
} from '../../signature/appearance-editor';
import { usersApi } from '../api';
import { useApiToast } from '../../toast/toast-provider';
import { apiErrorMessage } from '../../../lib/errors';
import { formatDate, formatDateTime, initials } from '../../../lib/format';
import type { User } from '../../../types/api';

export function UserDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const userId = Number(id);
  const { toast } = useApiToast();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sigBusy, setSigBusy] = useState(false);
  const sigEditorRef = useRef<AppearanceEditorHandle>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);
    usersApi
      .get(userId)
      .then((u) => alive && setUser(u))
      .catch((err) => alive && setLoadError(apiErrorMessage(err)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [userId]);

  const saveSignature = async () => {
    const value = await sigEditorRef.current?.resolve();
    if (!value) return;
    setSigBusy(true);
    try {
      const updated = await usersApi.setSignature(userId, value);
      setUser((u) => (u ? { ...u, ...updated } : u));
      toast.success('Assinatura salva');
    } catch (err) {
      toast.error('Não foi possível salvar', apiErrorMessage(err));
    } finally {
      setSigBusy(false);
    }
  };

  const removeSignature = async () => {
    setSigBusy(true);
    try {
      const updated = await usersApi.setSignature(userId, { signature: null });
      setUser((u) => (u ? { ...u, ...updated } : u));
      toast.success('Assinatura removida');
    } catch (err) {
      toast.error('Não foi possível remover', apiErrorMessage(err));
    } finally {
      setSigBusy(false);
    }
  };

  if (loading) return <PageSkeleton />;

  if (loadError || !user) {
    return (
      <Card variant="soft" className="py-14 text-center">
        <p className="text-sm font-semibold text-destructive">{loadError ?? 'Usuário não encontrado.'}</p>
        <Link to="/admin/usuarios">
          <Button variant="secondary" size="sm" className="mt-3">Voltar</Button>
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <Link
          to="/admin/usuarios"
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary transition-colors hover:text-primary-dark"
        >
          <ArrowLeft className="size-4" /> Usuários
        </Link>
      </div>

      <Card className="p-6">
        <div className="flex flex-wrap items-center gap-5">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-shell bg-primary-soft text-xl font-extrabold text-primary-dark">
            {initials(user.name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-extrabold tracking-tight text-ink">{user.name}</h1>
              <Badge variant={user.role === 'ADMIN' ? 'primary' : 'neutral'}>
                {user.role === 'ADMIN' ? 'Administrador' : 'Atendente'}
              </Badge>
              <UserStatusBadge status={user.status} />
            </div>
            <p className="mt-1 truncate text-[13px] text-muted">{user.email}</p>
          </div>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-card bg-surfaceBlue2 px-4 py-3">
            <span className="block text-[11px] font-bold uppercase tracking-wide text-muted">E-mail</span>
            <span className="block truncate text-[13px] font-semibold text-ink">{user.email}</span>
          </div>
          <div className="rounded-card bg-surfaceBlue2 px-4 py-3">
            <span className="block text-[11px] font-bold uppercase tracking-wide text-muted">Criado em</span>
            <span className="block text-[13px] font-semibold text-ink">{formatDate(user.createdAt)}</span>
          </div>
          <div className="rounded-card bg-surfaceBlue2 px-4 py-3">
            <span className="block text-[11px] font-bold uppercase tracking-wide text-muted">Assinatura</span>
            <span className="block text-[13px] font-semibold text-ink">
              {user.signatureUpdatedAt ? `Registrada em ${formatDateTime(user.signatureUpdatedAt)}` : 'Não registrada'}
            </span>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Aparência da assinatura</CardTitle>
            <CardDescription>
              A aparência da assinatura define como ela aparecerá nos campos de assinatura
              quando este usuário assinar um documento.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {user.signature && (
              <Button type="button" variant="ghost" loading={sigBusy} onClick={() => void removeSignature()}>
                Excluir
              </Button>
            )}
            <Button type="button" variant="secondary" onClick={() => sigEditorRef.current?.reset()}>
              Cancelar
            </Button>
            <Button type="button" loading={sigBusy} onClick={() => void saveSignature()}>
              <PenLine className="size-4" /> Salvar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {user.signature && (
            <div className="mb-4 max-w-md">
              <Label>Assinatura atual</Label>
              <img
                src={user.signature}
                alt={`Assinatura de ${user.name}`}
                className="mt-1 aspect-[13/4] w-full rounded-small border border-black/10 bg-white object-contain"
              />
              {user.rubricImage && (
                <img
                  src={user.rubricImage}
                  alt={`Rubrica de ${user.name}`}
                  className="mt-2 h-14 w-32 rounded-small border border-black/10 bg-white object-contain"
                />
              )}
            </div>
          )}
          <AppearanceEditor
            ref={sigEditorRef}
            initial={
              user.signature
                ? {
                    signature: user.signature,
                    signatureType: user.signatureType,
                    signatureText: user.signatureText,
                    rubricText: user.rubricText,
                    rubricImage: user.rubricImage,
                    fontFamily: user.fontFamily,
                  }
                : null
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
