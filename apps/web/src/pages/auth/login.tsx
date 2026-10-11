import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, KeyRound } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Label } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { useAuth } from '../../features/auth/auth-provider';
import { useReaderSession } from '../../features/readers/reader-session';
import { useToast } from '../../features/toast/toast-provider';
import { apiErrorMessage } from '../../lib/errors';

export function LoginPage() {
  const { login } = useAuth();
  const { login: readerLogin, claim: claimAccount } = useReaderSession();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'staff' | 'reader'>('staff');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimCpf, setClaimCpf] = useState('');
  const [claimEmail, setClaimEmail] = useState('');
  const [claimPassword, setClaimPassword] = useState('');

  const submitClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const reader = await claimAccount(claimCpf.trim(), claimEmail.trim(), claimPassword);
      toast('success', `Conta ativada! Bem-vindo(a), ${reader.name.split(' ')[0]}!`);
      setClaiming(false);
      navigate('/minha-conta');
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };
    const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'staff') {
        const user = await login(email.trim(), password);
        toast('success', `Bem-vindo(a), ${user.name.split(' ')[0]}!`);
        navigate('/admin');
      } else {
        const reader = await readerLogin(email.trim(), password);
        toast('success', `Bem-vindo(a), ${reader.name.split(' ')[0]}!`);
        navigate('/minha-conta');
      }
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            'radial-gradient(700px 300px at 50% -5%, rgba(8,127,140,.12), transparent 60%)',
        }}
      />
      <div className="shell w-full max-w-md">
        <div className="hairline rounded-[15px] bg-surface p-7 sm:p-8">
          <Link to="/" className="mb-6 flex items-center gap-2.5">
            <span className="flex size-10 items-center justify-center rounded-control bg-primary text-white shadow-card">
              <BookOpen className="size-5" />
            </span>
            <span>
              <span className="block text-[15px] font-extrabold tracking-tight text-ink">
                Biblioteca Pública
              </span>
              <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
                {mode === 'staff' ? 'Área da equipe' : 'Área do leitor'}
              </span>
            </span>
          </Link>

          <h1 className="text-xl font-extrabold tracking-tight text-ink">Entrar</h1>
          <p className="mt-1 text-[13px] text-muted">
            {mode === 'staff'
              ? 'Acesse com suas credenciais de administrador ou atendente.'
              : 'Acesse sua conta de leitor com e-mail e senha.'}
          </p>

          <div className="mt-4 grid grid-cols-2 gap-1 rounded-control bg-canvas p-1">
            {(['staff', 'reader'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { setMode(m); setError(null); }}
                className={`rounded-small py-1.5 text-[13px] font-bold transition-all ${
                  mode === m ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'
                }`}
              >
                {m === 'staff' ? 'Equipe' : 'Leitor'}
              </button>
            ))}
          </div>

          {mode === 'reader' && !claiming ? (
            <form onSubmit={submit} className="mt-6 space-y-4">
              <div>
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="voce@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="password">Senha</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {error && (
                <div className="rounded-card bg-destructive-soft px-4 py-3 text-[13px] font-semibold text-destructive">
                  {error}
                </div>
              )}
              <Button type="submit" loading={loading} className="w-full" size="lg">
                <KeyRound className="size-4" />
                Entrar
              </Button>
              <Link
                to="/esqueci-senha"
                className="block w-full text-center text-[12.5px] font-semibold text-primary hover:text-primary-dark"
              >
                Esqueci minha senha
              </Link>
              <button
                type="button"
                onClick={() => { setClaiming(true); setError(null); }}
                className="w-full text-center text-[12.5px] font-semibold text-primary hover:text-primary-dark"
              >
                Primeiro acesso? Ative sua conta
              </button>
            </form>
          ) : mode === 'reader' ? (
            <form onSubmit={submitClaim} className="mt-6 space-y-4">
              <p className="rounded-card bg-surfaceBlue2 px-4 py-3 text-[12.5px] leading-relaxed text-primary-dark">
                Já possui cadastro no balcão? Confirme CPF e e-mail para criar sua senha de acesso.
              </p>
              <div>
                <Label htmlFor="claim-cpf">CPF cadastrado</Label>
                <Input
                  id="claim-cpf"
                  placeholder="000.000.000-00"
                  inputMode="numeric"
                  value={claimCpf}
                  onChange={(e) => setClaimCpf(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="claim-email">E-mail cadastrado</Label>
                <Input
                  id="claim-email"
                  type="email"
                  placeholder="voce@email.com"
                  value={claimEmail}
                  onChange={(e) => setClaimEmail(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="claim-password">Criar senha</Label>
                <Input
                  id="claim-password"
                  type="password"
                  placeholder="Mínimo 6 caracteres"
                  autoComplete="new-password"
                  value={claimPassword}
                  onChange={(e) => setClaimPassword(e.target.value)}
                  required
                />
              </div>
              {error && (
                <div className="rounded-card bg-destructive-soft px-4 py-3 text-[13px] font-semibold text-destructive">
                  {error}
                </div>
              )}
              <Button type="submit" loading={loading} className="w-full" size="lg">
                <KeyRound className="size-4" />
                Ativar conta
              </Button>
              <button
                type="button"
                onClick={() => { setClaiming(false); setError(null); }}
                className="w-full text-center text-[12.5px] font-semibold text-primary hover:text-primary-dark"
              >
                ← Voltar ao login
              </button>
            </form>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-4">
              <div>
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="voce@biblioteca.local"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="password">Senha</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {error && (
                <div className="rounded-card bg-destructive-soft px-4 py-3 text-[13px] font-semibold text-destructive">
                  {error}
                </div>
              )}
              <Button type="submit" loading={loading} className="w-full" size="lg">
                <KeyRound className="size-4" />
                Entrar
              </Button>
              <Link
                to="/esqueci-senha"
                className="block w-full text-center text-[12.5px] font-semibold text-primary hover:text-primary-dark"
              >
                Esqueci minha senha
              </Link>
            </form>
          )}

          

          <p className="mt-6 text-center text-[12.5px] text-muted">
            {mode === 'reader' ? (
              <>
                Ainda não tem conta?{' '}
                <Link to="/cadastro" className="font-semibold text-primary transition-colors hover:text-primary-dark">
                  Criar conta
                </Link>
                {' · '}
              </>
            ) : null}
            <Link to="/" className="font-semibold text-primary transition-colors hover:text-primary-dark">
              ← Voltar ao catálogo
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
