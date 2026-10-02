import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  DoorOpen,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import {
  FcBookmark,
  FcBusinessman,
  FcCancel,
  FcComboChart,
  FcConferenceCall,
  FcDatabase,
  FcInspection,
  FcLibrary,
  FcLineChart,
  FcOpenedFolder,
  FcPortraitMode,
  FcPrint,
  FcReading,
  FcSettings,
  FcUndo,
} from 'react-icons/fc';
import { useState } from 'react';
import { useAuth } from '../../features/auth/auth-provider';
import { cn } from '../../lib/utils';
import { initials } from '../../lib/format';
import { Logo } from './public-layout';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown';

const navSections: {
  label: string;
  items: { to: string; label: string; icon: React.ComponentType<{ className?: string }>; adminOnly?: boolean }[];
}[] = [
  {
    label: 'Operação',
    items: [
      { to: '/admin', label: 'Dashboard', icon: FcComboChart, adminOnly: false },
      { to: '/admin/emprestimos', label: 'Empréstimos', icon: FcReading, adminOnly: false },
      { to: '/admin/devolucoes', label: 'Devoluções', icon: FcUndo, adminOnly: false },
      { to: '/admin/reservas', label: 'Reservas', icon: FcBookmark, adminOnly: false },
    ],
  },
  {
    label: 'Acervo',
    items: [
      { to: '/admin/livros', label: 'Livros', icon: FcLibrary, adminOnly: false },
      { to: '/admin/etiquetas', label: 'Etiquetas', icon: FcPrint, adminOnly: false },
      { to: '/admin/autores', label: 'Autores', icon: FcPortraitMode, adminOnly: true },
      { to: '/admin/categorias', label: 'Categorias', icon: FcOpenedFolder, adminOnly: true },
    ],
  },
  {
    label: 'Comunidade',
    items: [
      { to: '/admin/leitores', label: 'Leitores', icon: FcConferenceCall, adminOnly: false },
      { to: '/admin/blocklist', label: 'BlockList', icon: FcCancel, adminOnly: false },
      { to: '/admin/relatorios', label: 'Relatórios', icon: FcLineChart, adminOnly: true },
      { to: '/admin/usuarios', label: 'Usuários', icon: FcBusinessman, adminOnly: true },
      { to: '/admin/auditoria', label: 'Auditoria', icon: FcInspection, adminOnly: true },
      { to: '/admin/backup', label: 'Backup', icon: FcDatabase, adminOnly: true },
      { to: '/admin/configuracoes', label: 'Configurações', icon: FcSettings, adminOnly: true },
    ],
  },
];

export function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (!user) return null;

  return (
    <div className="min-h-screen bg-canvas p-2 sm:p-3 lg:p-4">
      <div className="mx-auto max-w-[1440px] rounded-shell bg-white/[0.48] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,.78),0_0_0_1px_var(--hairline),0_28px_60px_-40px_rgba(23,26,26,.32)]">
        <div className="grid min-h-[calc(100dvh-2rem)] grid-cols-1 overflow-hidden rounded-core bg-surface shadow-[inset_0_0_0_1px_var(--hairline)] lg:grid-cols-[246px_1fr]">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[246px] flex-col bg-[#F6F2EA] text-ink shadow-[0_0_0_1px_var(--hairline),0_24px_48px_-32px_rgba(23,26,26,.3)] transition-transform duration-300 [transition-timing-function:var(--ease)] lg:static lg:translate-x-0 lg:border-r lg:border-black/8 lg:shadow-none',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 items-center justify-between px-5">
          <Logo />
          <button
            className="flex size-9 items-center justify-center rounded-control text-muted transition-colors hover:bg-white/60 lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Fechar menu"
          >
            <X className="size-5" />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {navSections.map((section) => {
            const visible = section.items.filter((i) =>
              i.adminOnly ? user.role === 'ADMIN' : true,
            );
            if (visible.length === 0) return null;
            return (
              <div key={section.label} className="mb-5">
                <p className="mb-1.5 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted/60">
                  {section.label}
                </p>
                <ul className="space-y-0.5">
                  {visible.map((item) => (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.to === '/admin'}
                        onClick={() => setMobileOpen(false)}
                        className={({ isActive }) =>
                          cn(
                            'group flex min-h-10 items-center gap-3 rounded-control px-3 py-2 text-[13.5px] font-semibold transition-all duration-150',
                            isActive
                              ? 'bg-primary-soft text-primary-dark shadow-[inset_3px_0_0_#087F8C]'
                              : 'text-muted hover:bg-white/60 hover:text-ink',
                          )
                        }
                      >
                        <item.icon className="size-[17px] shrink-0" />
                        {item.label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
        <div className="border-t border-black/8 p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-full items-center gap-3 rounded-control bg-white/[0.52] px-2 py-2 text-left shadow-[inset_0_0_0_1px_var(--hairline)] transition-colors duration-150 hover:bg-white/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[12px] font-extrabold text-primary-dark">
                  {initials(user.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold text-ink">
                    {user.name}
                  </span>
                  <span className="block text-[11px] text-muted">
                    {user.role === 'ADMIN' ? 'Administrador' : 'Atendente'}
                  </span>
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => navigate('/')}>
                <BookOpen className="size-4" />
                Ver site público
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => logout()}>
                <LogOut className="size-4" />
                Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-ink/40 backdrop-blur-[2px] anim-fade lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <div className="flex min-w-0 flex-col">
        <header className="flex h-16 items-center justify-between gap-3 border-b border-black/8 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              className="flex size-9 items-center justify-center rounded-control text-ink transition-colors hover:bg-canvas lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Abrir menu"
            >
              <Menu className="size-5" />
            </button>
            <h1 className="hidden text-[15px] font-extrabold tracking-tight text-ink sm:block">
              Painel de Gestão
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <NavLink
              to="/"
              className="hidden items-center gap-1.5 rounded-control px-3 py-2 text-[13px] font-semibold text-muted transition-colors hover:bg-canvas hover:text-ink sm:flex"
            >
              <DoorOpen className="size-4" />
              Site público
            </NavLink>
          </div>
        </header>
        <main className="flex-1 px-4 py-5 sm:px-5 lg:px-6">
            <Outlet />
          </main>
      </div>
        </div>
      </div>
    </div>
  );
}
