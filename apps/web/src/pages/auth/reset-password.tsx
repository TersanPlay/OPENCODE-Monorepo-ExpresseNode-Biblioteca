import { Link, useSearchParams } from 'react-router-dom';
import { BookOpen, CircleCheck } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Label } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { api, apiReader } from '../../services/api-client';
import { apiErrorMessage } from '../../lib/errors';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const tipo = params.get('tipo') === 'leitor' ? 'reader' : 'staff';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('As senhas não conferem');
      return;
    }
    setLoading(true);
    try {
      if (tipo === 'staff') {
        await api.post('/auth/reset-password', { token, password });
      } else {
        await apiReader.post('/readers/reset-password', { token, password });
      }
      setDone(true);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="shell w-full max-w-md">
        <div className="hairline rounded-[15px] bg-surface p-7 sm:p-8">
          <Link to="/login" className="mb-6 flex items-center gap-2.5">
            <span className="flex size-10 items-center justify-center rounded-control bg-primary text-white shadow-card">
              <BookOpen className="size-5" />
            </span>
            <span>
              <span className="block text-[15px] font-extrabold tracking-tight text-ink">
                Biblioteca Pública
              </span>
              <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
                Nova senha
              </span>
            </span>
          </Link>

          <h1 className="text-xl font-extrabold tracking-tight text-ink">Redefinir senha</h1>

          {!token ? (
            <p className="mt-2 rounded-card bg-destructive-soft px-4 py-3 text-[13px] font-semibold text-destructive">
              Link inválido ou expirado. Solicite um novo link na página de recuperação.
            </p>
          ) : done ? (
            <div className="mt-4 rounded-card bg-surfaceBlue2 px-4 py-4 text-[13px] leading-relaxed text-primary-dark">
              <p className="flex items-center gap-2 font-bold">
                <CircleCheck className="size-4" />
                Senha alterada com sucesso
              </p>
              <p className="mt-1">
                <Link to="/login" className="font-semibold text-primary hover:text-primary-dark">
                  Voltar ao login
                </Link>
              </p>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-4">
              <div>
                <Label htmlFor="np-password">Nova senha</Label>
                <Input
                  id="np-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Mínimo 6 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="np-confirm">Confirmar nova senha</Label>
                <Input
                  id="np-confirm"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Repita a nova senha"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </div>
              {error && (
                <div className="rounded-card bg-destructive-soft px-4 py-3 text-[13px] font-semibold text-destructive">
                  {error}
                </div>
              )}
              <Button type="submit" loading={loading} className="w-full" size="lg">
                Salvar nova senha
              </Button>
            </form>
          )}

          <p className="mt-6 text-center text-[12.5px] text-muted">
            <Link to="/esqueci-senha" className="font-semibold text-primary transition-colors hover:text-primary-dark">
              Solicitar novo link
            </Link>
            {' · '}
            <Link to="/login" className="font-semibold text-primary transition-colors hover:text-primary-dark">
              Voltar ao login
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
