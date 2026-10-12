import { Link, Outlet, useNavigate } from 'react-router-dom';
import { BookOpen, LogOut, Search, UserRound } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../../features/auth/auth-provider';
import { useReaderSession } from '../../features/readers/reader-session';
import { useLibrarySettings } from '../../features/settings/use-library-settings';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown';
import { initials } from '../../lib/format';

export function Logo({ compact, name }: { compact?: boolean; name?: string | null }) {
  const displayName = name?.trim() || 'Biblioteca Pública';
  return (
    <Link to="/" className="flex items-center gap-2.5" aria-label={`${displayName} — início`}>
      <span className="flex size-9 items-center justify-center rounded-control bg-primary text-white shadow-card">
        <BookOpen className="size-5" />
      </span>
      {!compact && (
        <span className="min-w-0 leading-tight">
          <span className="block max-w-[280px] truncate text-[15px] font-extrabold tracking-tight text-ink">
            {displayName}
          </span>
          <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
            Catálogo &amp; Gestão
          </span>
        </span>
      )}
    </Link>
  );
}

export function PublicNavbar() {
  const { user, logout } = useAuth();
  const { reader, logout: readerLogout } = useReaderSession();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const settings = useLibrarySettings();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    navigate(`/catalogo?q=${encodeURIComponent(query.trim())}`);
    setQuery('');
    setOpen(false);
  };

  const navLinks = [
    { to: '/catalogo', label: 'Catálogo' },
    { to: '/#sobre', label: 'Sobre' },
  ];

  return (
    <header className="fixed inset-x-0 top-0 z-30 px-3 pt-3 sm:px-6 sm:pt-4">
      <div className="mx-auto w-full max-w-[960px] rounded-shell p-[5px] backdrop-blur-[22px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,.88),0_0_0_1px_var(--hairline),0_18px_40px_-28px_rgba(23,26,26,.34)]" style={{ background: 'rgba(255,253,249,.68)' }}>
        <div className="flex h-14 items-center justify-between gap-3 rounded-core bg-[rgba(255,255,255,.5)] px-2 sm:px-3">
          <Logo name={settings?.libraryName} />
          <nav className="hidden items-center gap-1 md:flex">
            {navLinks.map((l) => (
              <Link
                key={l.label}
                to={l.to}
                className="rounded-control px-3.5 py-2 text-[13.5px] font-semibold text-ink transition-colors duration-150 hover:bg-canvas"
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <form onSubmit={submit} className="relative hidden sm:block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar livros..."
                className="h-9 w-56 rounded-full bg-canvas pl-9 pr-3 text-[13px] text-ink placeholder:text-muted/70 shadow-[inset_0_0_0_1px_rgba(23,26,26,.08)] transition-all duration-200 [transition-timing-function:var(--ease)] focus:w-64 focus:outline-none focus:shadow-[inset_0_0_0_2px_#087F8C]"
              />
            </form>
            {reader ? (
              <DropdownMenu open={open} onOpenChange={setOpen}>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 transition-colors duration-150 hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    aria-label="Menu do leitor"
                  >
                    <span className="flex size-8 items-center justify-center rounded-full bg-primary-soft text-[12px] font-extrabold text-primary-dark">
                      {initials(reader.name)}
                    </span>
                    <span className="hidden text-[13px] font-semibold text-ink lg:block">
                      {reader.name.split(' ')[0]}
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>{reader.email ?? reader.name}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => navigate('/minha-conta')}>
                    <BookOpen className="size-4" />
                    Minha conta
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={() => readerLogout()}>
                    <LogOut className="size-4" />
                    Sair
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : user ? (
              <DropdownMenu open={open} onOpenChange={setOpen}>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 transition-colors duration-150 hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    aria-label="Menu do usuário"
                  >
                    <span className="flex size-8 items-center justify-center rounded-full bg-primary-soft text-[12px] font-extrabold text-primary-dark">
                      {initials(user.name)}
                    </span>
                    <span className="hidden text-[13px] font-semibold text-ink lg:block">
                      {user.name.split(' ')[0]}
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => navigate('/admin')}>
                    <BookOpen className="size-4" />
                    Painel de gestão
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={() => logout()}>
                    <LogOut className="size-4" />
                    Sair
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <>
                <Link
                  to="/cadastro"
                  className="hidden h-9 items-center rounded-full px-3 text-[13px] font-semibold text-primary transition-colors hover:bg-canvas sm:flex"
                >
                  Criar conta
                </Link>
                <Link
                  to="/login"
                  className="hidden h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-[13px] font-semibold text-white shadow-card transition-all duration-200 [transition-timing-function:var(--ease)] hover:bg-primary-dark active:scale-[.98] sm:flex"
                >
                  <UserRound className="size-4" />
                  Entrar
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

export function PublicFooter() {
  const settings = useLibrarySettings();

  const hasContact = Boolean(
    settings?.libraryHours || settings?.libraryEmail || settings?.libraryPhone,
  );

  return (
    <footer id="sobre" className="mt-20 bg-ink px-6 py-14 text-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-10 md:flex-row md:items-start md:justify-between">
        <div className="max-w-md">
          <Logo name={settings?.libraryName} />
          <p className="mt-4 text-[13.5px] leading-relaxed text-white/60">
            Sistema público de catalogação, empréstimo e gestão de acervo. Acesse o catálogo,
            consulte disponibilidade e, com credenciais de equipe, gerencie leitores, livros e
            empréstimos.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-10 text-sm">
          <div>
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-white/40">
              Navegação
            </p>
            <ul className="space-y-2 text-white/70">
              <li>
                <Link to="/catalogo" className="transition-colors hover:text-white">
                  Catálogo completo
                </Link>
              </li>
                <li>
                  <Link to="/login" className="transition-colors hover:text-white">
                    Área da equipe
                  </Link>
                </li>
                <li>
                  <Link to="/cadastro" className="transition-colors hover:text-white">
                    Criar conta de leitor
                  </Link>
                </li>
            </ul>
          </div>
          <div>
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-white/40">
              Contato
            </p>
            <ul className="space-y-2 text-white/70">
              {settings?.libraryHours && <li>Horário: {settings.libraryHours}</li>}
              {settings?.libraryEmail && <li>{settings.libraryEmail}</li>}
              {settings?.libraryPhone && <li>{settings.libraryPhone}</li>}
            </ul>
            {!hasContact && (
              <p className="text-[12.5px] text-white/40">
                Informações de contato não configuradas.
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="mx-auto mt-12 flex max-w-7xl items-center justify-between border-t border-white/10 pt-5">
        <p className="text-[12px] text-white/40">
          © {new Date().getFullYear()} Biblioteca Pública — MVP de gestão de acervo.
        </p>
        <p className="hidden font-mono text-[11px] text-white/30 sm:block">v1.0 · Stack Express + React</p>
      </div>
    </footer>
  );
}

export function PublicLayout() {
  return (
    <div className="min-h-screen bg-canvasWarm">
      <PublicNavbar />
      <main className="pt-28">
        <Outlet />
      </main>
      <PublicFooter />
    </div>
  );
}
