import { Link } from 'react-router-dom';
import { BookOpen, MailCheck } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Label } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { api, apiReader } from '../../services/api-client';
import { apiErrorMessage } from '../../lib/errors';

export function ForgotPasswordPage() {
  const [mode, setMode] = useState<'staff' | 'reader'>('staff');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'staff') {
        await api.post('/auth/forgot-password', { email: email.trim() });
      } else {
        await apiReader.post('/readers/forgot-password', { email: email.trim() });
      }
      setSent(true);
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
                Recuperação de senha
              </span>
            </span>
          </Link>

          <h1 className="text-xl font-extrabold tracking-tight text-ink">Esqueci minha senha</h1>
          <p className="mt-1 text-[13px] text-muted">
            Informe seu e-mail para receber o link de redefinição válido por 1 hora.
          </p>

          <div className="mt-4 grid grid-cols-2 gap-1 rounded-control bg-canvas p-1">
            {(['staff', 'reader'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { setMode(m); setError(null); setSent(false); }}
                className={`rounded-small py-1.5 text-[13px] font-bold transition-all ${
                  mode === m ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'
                }`}
              >
                {m === 'staff' ? 'Equipe' : 'Leitor'}
              </button>
            ))}
          </div>

          {sent ? (
            <div className="mt-6 rounded-card bg-surfaceBlue2 px-4 py-4 text-[13px] leading-relaxed text-primary-dark">
              <p className="flex items-center gap-2 font-bold">
                <MailCheck className="size-4" />
                Verifique seu e-mail
              </p>
              <p className="mt-1">
                Se o endereço digitado estiver cadastrado em nosso sistema, enviamos as instruções
                para a recuperação da sua senha.
              </p>
              <p className="anim-note -mx-2 mt-2 rounded-small border-l-[3px] border-primary px-3 py-1.5 text-[13.5px] leading-relaxed">
                <strong className="font-extrabold uppercase tracking-[0.08em] text-primary-dark">
                  Nota:
                </strong>{' '}
                <span className="font-semibold">
                  Não recebeu a mensagem? Verifique também a sua caixa de{' '}
                  <strong className="rounded-small bg-primary px-1.5 py-0.5 font-extrabold text-white">
                    spam ou lixo eletrônico
                  </strong>
                  .
                </span>
              </p>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-4">
              <div>
                <Label htmlFor="fp-email">E-mail</Label>
                <Input
                  id="fp-email"
                  type="email"
                  autoComplete="email"
                  placeholder="voce@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              {error && (
                <div className="rounded-card bg-destructive-soft px-4 py-3 text-[13px] font-semibold text-destructive">
                  {error}
                </div>
              )}
              <Button type="submit" loading={loading} className="w-full" size="lg">
                Enviar link de recuperação
              </Button>
            </form>
          )}

          <p className="mt-6 text-center text-[12.5px] text-muted">
            <Link to="/login" className="font-semibold text-primary transition-colors hover:text-primary-dark">
              ← Voltar ao login
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
