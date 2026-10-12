import { useCallback, useEffect, useRef, useState } from 'react';
import { Building2, Save, SlidersHorizontal } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '../../../components/ui/button';
import { Card, CardTitle } from '../../../components/ui/card';
import { Label } from '../../../components/ui/form-field';
import { Input } from '../../../components/ui/input';
import { PageSkeleton } from '../../../components/ui/skeleton';
import { Textarea } from '../../../components/ui/textarea';
import { settingsApi } from '../../api';
import { useAsyncData } from '../../hooks/use-async-data';
import { invalidateLibrarySettings } from '../use-library-settings';
import { useApiToast } from '../../toast/toast-provider';
import { apiErrorMessage } from '../../../lib/errors';
import { cn } from '../../../lib/utils';

const schema = z.object({
  loanLimit: z.coerce.number().int().min(1, 'Mínimo 1').max(20, 'Máximo 20'),
  defaultLoanDays: z.coerce.number().int().min(1, 'Mínimo 1').max(90, 'Máximo 90'),
  maxRenewals: z.coerce.number().int().min(0, 'Mínimo 0').max(10, 'Máximo 10'),
  libraryName: z.string().min(2, 'Nome é obrigatório'),
  libraryAddress: z.string(),
  libraryPhone: z.string(),
  libraryEmail: z.string().email('E-mail inválido').or(z.literal('')),
  libraryHours: z.string(),
});

type Section = 'loans' | 'library';

const sections: { id: Section; label: string; desc: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'loans', label: 'Regras de empréstimo', desc: 'Limites, prazos e renovações', icon: SlidersHorizontal },
  { id: 'library', label: 'Dados da biblioteca', desc: 'Nome, contato e horário', icon: Building2 },
];

export function SettingsPage() {
  const fetcher = useCallback(() => settingsApi.get(), []);
  const { data, loading, error: loadError } = useAsyncData(fetcher, []);
  const [busy, setBusy] = useState(false);
  const [section, setSection] = useState<Section>('loans');
  const { toast } = useApiToast();

  const { register, handleSubmit, reset, formState: { errors } } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
  });

  const initialized = useCallback(() => {
    if (data) {
      reset({
        loanLimit: data.loanLimit,
        defaultLoanDays: data.defaultLoanDays,
        maxRenewals: data.maxRenewals,
        libraryName: data.libraryName,
        libraryAddress: data.libraryAddress ?? '',
        libraryPhone: data.libraryPhone ?? '',
        libraryEmail: data.libraryEmail ?? '',
        libraryHours: data.libraryHours ?? '',
      });
    }
  }, [data, reset]);

  const ref = useRef(false);
  useEffect(() => {
    if (!ref.current && data) {
      ref.current = true;
      initialized();
    }
  }, [data, initialized]);

  const submit = async (v: z.infer<typeof schema>) => {
    setBusy(true);
    try {
      await settingsApi.update(v);
      invalidateLibrarySettings();
      toast.success('Configurações salvas', 'As regras passam a valer imediatamente.');
    } catch (err) {
      toast.error('Não foi possível salvar', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <PageSkeleton />;

  if (loadError) {
    return (
      <Card variant="soft" className="py-14 text-center">
        <p className="text-sm font-semibold text-destructive">{loadError}</p>
      </Card>
    );
  }

  return (
    <div>
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">Configurações</h1>
        <p className="mt-1 text-[13.5px] text-muted">
          Regras de empréstimo e informações institucionais.
        </p>
      </div>

      <div className="mt-5 rounded-shell bg-white/48 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,.78),0_0_0_1px_var(--hairline),0_24px_48px_-32px_rgba(23,26,26,.24)]">
        <div className="grid gap-2 lg:grid-cols-[220px_1fr]">
          <nav
            aria-label="Seções de configurações"
            className="flex gap-1 overflow-x-auto rounded-card bg-white/[0.74] p-2 shadow-[inset_0_0_0_1px_var(--hairline)] lg:flex-col"
          >
            {sections.map((s) => {
              const active = section === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSection(s.id)}
                  className={cn(
                    'flex shrink-0 items-center gap-3 rounded-control px-3 py-2.5 text-left transition-all duration-150',
                    active
                      ? 'bg-primary-soft text-primary-dark shadow-[inset_3px_0_0_#087F8C]'
                      : 'text-muted hover:bg-white/60 hover:text-ink',
                  )}
                >
                  <s.icon className="size-[17px] shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold">{s.label}</span>
                    <span className="block truncate text-[11px] text-muted/80">{s.desc}</span>
                  </span>
                </button>
              );
            })}
          </nav>

          <form
            onSubmit={handleSubmit(submit)}
            className="rounded-card bg-white/[0.74] p-5 shadow-[inset_0_0_0_1px_var(--hairline),0_24px_48px_-32px_rgba(23,26,26,.24)]"
          >
            {section === 'loans' ? (
              <div>
                <CardTitle>Regras de empréstimo</CardTitle>
                <p className="mt-1 text-[12.5px] text-muted">
                  Aplicadas automaticamente na criação de empréstimos e renovações.
                </p>
                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  <div>
                    <Label>Limite de empréstimos por leitor</Label>
                    <Input type="number" min={1} max={20} {...register('loanLimit')} />
                  </div>
                  <div>
                    <Label>Prazo padrão (dias)</Label>
                    <Input type="number" min={1} max={90} {...register('defaultLoanDays')} />
                  </div>
                  <div>
                    <Label>Máx. renovações</Label>
                    <Input type="number" min={0} max={10} {...register('maxRenewals')} />
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <CardTitle>Dados da biblioteca</CardTitle>
                <p className="mt-1 text-[12.5px] text-muted">
                  Exibidos no site público quando configurados.
                </p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Label>Nome da instituição *</Label>
                    <Input {...register('libraryName')} error={errors.libraryName?.message} />
                  </div>
                  <div className="sm:col-span-2">
                    <Label>Endereço</Label>
                    <Textarea rows={2} {...register('libraryAddress')} />
                  </div>
                  <div>
                    <Label>Telefone</Label>
                    <Input {...register('libraryPhone')} />
                  </div>
                  <div>
                    <Label>E-mail público</Label>
                    <Input type="email" {...register('libraryEmail')} error={errors.libraryEmail?.message} />
                  </div>
                  <div className="sm:col-span-2">
                    <Label>Horário de funcionamento</Label>
                    <Input placeholder="seg–sex 8h–18h" {...register('libraryHours')} />
                  </div>
                </div>
              </div>
            )}

            <div className="mt-6 flex justify-end border-t border-black/8 pt-4">
              <Button type="submit" loading={busy}>
                <Save className="size-4" /> Salvar configurações
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
