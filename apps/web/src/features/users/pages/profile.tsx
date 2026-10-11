import { useEffect, useRef, useState } from 'react';
import { Info, PenLine } from 'lucide-react';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/form-field';
import { Skeleton } from '../../../components/ui/skeleton';
import {
  AppearanceEditor,
  type AppearanceEditorHandle,
} from '../../signature/appearance-editor';
import { useApiToast } from '../../toast/toast-provider';
import { apiErrorMessage } from '../../../lib/errors';
import { formatDateTime, initials } from '../../../lib/format';
import { usersApi } from '../api';
import type { User } from '../../../types/api';

export function ProfilePage() {
  const { toast } = useApiToast();
  const [me, setMe] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editorRef = useRef<AppearanceEditorHandle>(null);

  useEffect(() => {
    let alive = true;
    usersApi
      .getMe()
      .then((u) => alive && setMe(u))
      .catch((err) => alive && setLoadError(apiErrorMessage(err)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const save = async () => {
    const value = await editorRef.current?.resolve();
    if (!value) return;
    setBusy(true);
    try {
      const updated = await usersApi.patchMeSignature(value);
      setMe((m) => (m ? { ...m, ...updated } : m));
      toast.success('Assinatura salva', 'A nova aparência será usada nas próximas assinaturas.');
    } catch (err) {
      toast.error('Não foi possível salvar', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (loadError || !me) {
    return (
      <div className="rounded-card bg-surface px-4 py-3 text-[13px] text-destructive">
        {loadError ?? 'Perfil indisponível.'}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Meu perfil</h1>
          <p className="mt-1 text-[13.5px] text-muted">
            Dados da sua conta e a aparência da assinatura usada nos documentos.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Informações pessoais</CardTitle>
            <CardDescription>
              As informações pessoais são dados da sua conta; elas aparecem para outras pessoas
              quando você cria e assina documentos.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-3">
              <p className="text-[13px] font-bold text-ink">Dados pessoais</p>
              <div>
                <Label htmlFor="pf-name">Nome completo</Label>
                <Input id="pf-name" value={me.name} readOnly className="bg-canvas" />
              </div>
              <div>
                <Label htmlFor="pf-email">E-mail</Label>
                <Input id="pf-email" value={me.email} readOnly className="bg-canvas" />
              </div>
            </div>
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-[13px] font-bold text-ink">
                Como aparecerá no documento
                <Info className="size-3.5 text-muted" />
              </p>
              <div className="rounded-card bg-surfaceBlue2 p-4 hairline">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-[13px] font-extrabold text-ink">
                    Signatário
                    <Badge variant="primary">
                      {me.role === 'ADMIN' ? 'Administrador' : 'Atendente'}
                    </Badge>
                  </span>
                  {me.signature ? (
                    <Badge variant="success" className="gap-1">
                      <PenLine className="size-3" /> Assinou
                    </Badge>
                  ) : (
                    <Badge variant="neutral">Não assinou</Badge>
                  )}
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[13px] font-extrabold text-primary-dark">
                    {initials(me.name)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-bold text-ink">{me.name}</p>
                    <p className="truncate text-[12px] text-muted">{me.email}</p>
                  </div>
                </div>
                {me.signature && (
                  <div className="mt-3 overflow-hidden rounded-small border border-black/10 bg-white">
                    <img src={me.signature} alt="Assinatura registrada" className="aspect-[13/4] w-full object-contain" />
                  </div>
                )}
                <p className="mt-3 text-[12px] text-muted">
                  {me.signatureUpdatedAt
                    ? `Assinatura registrada em ${formatDateTime(me.signatureUpdatedAt)}`
                    : 'Nenhuma assinatura registrada.'}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Aparência da assinatura</CardTitle>
            <CardDescription>
              A aparência da sua assinatura define como ela aparecerá nos campos de assinatura
              quando você assinar um documento.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={() => editorRef.current?.reset()}>
              Cancelar
            </Button>
            <Button type="button" loading={busy} onClick={() => void save()}>
              <PenLine className="size-4" /> Salvar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <AppearanceEditor
            ref={editorRef}
            initial={
              me.signature
                ? {
                    signature: me.signature,
                    signatureType: me.signatureType,
                    signatureText: me.signatureText,
                    rubricText: me.rubricText,
                    rubricImage: me.rubricImage,
                    fontFamily: me.fontFamily,
                  }
                : null
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
