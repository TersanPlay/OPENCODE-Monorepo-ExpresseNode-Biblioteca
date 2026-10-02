import { Route, Routes } from 'react-router-dom';
import { AdminLayout } from '../../components/layout/admin-layout';
import { PublicLayout } from '../../components/layout/public-layout';
import { RequireAdmin, RequireAuth, RequireReader } from './guards';
import { HomePage } from '../../pages/public/home';
import { CatalogPage } from '../../pages/public/catalog';
import { BookDetailsPage } from '../../pages/public/book-details';
import { ArchitecturePage } from '../../pages/public/architecture';
import { RegisterPage } from '../../pages/public/register';
import { LoginPage } from '../../pages/auth/login';
import { ReaderAccountPage } from '../../pages/reader/account';
import { DashboardPage } from '../../pages/admin/dashboard';
import { BooksPage } from '../../pages/admin/books';
import { BookFormPage } from '../../pages/admin/book-form';
import { AuthorsPage } from '../../pages/admin/authors';
import { CategoriesPage } from '../../pages/admin/categories';
import { ReadersPage } from '../../pages/admin/readers';
import { ReaderDetailsPage } from '../../pages/admin/reader-details';
import { LoansPage } from '../../pages/admin/loans';
import { NewLoanPage } from '../../pages/admin/new-loan';
import { ReturnsPage } from '../../pages/admin/returns';
import { ReturnDetailPage } from '../../pages/admin/return-detail';
import { ReservationsPage } from '../../pages/admin/reservations';
import { ReportsPage } from '../../pages/admin/reports';
import { LabelsPage } from '../../pages/admin/labels';
import { UsersPage } from '../../pages/admin/users';
import { SettingsPage } from '../../pages/admin/settings';
import { AuditPage } from '../../pages/admin/audit';
import { BackupsPage } from '../../pages/admin/backups';
import { BlockListPage } from '../../pages/admin/blocklist';
import { NotFoundPage } from '../../pages/not-found';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<HomePage />} />
        <Route path="catalogo" element={<CatalogPage />} />
        <Route path="livros/:id" element={<BookDetailsPage />} />
        <Route path="arquitetura" element={<ArchitecturePage />} />
      </Route>
      <Route path="cadastro" element={<RegisterPage />} />
      <Route path="login" element={<LoginPage />} />
      <Route element={<RequireReader />}>
        <Route element={<PublicLayout />}>
          <Route path="minha-conta" element={<ReaderAccountPage />} />
        </Route>
      </Route>
      <Route element={<RequireAuth />}>
        <Route element={<AdminLayout />}>
          <Route path="admin" element={<DashboardPage />} />
          <Route path="admin/livros" element={<BooksPage />} />
          <Route path="admin/livros/novo" element={<BookFormPage />} />
          <Route path="admin/livros/:id/editar" element={<BookFormPage />} />
          <Route path="admin/etiquetas" element={<LabelsPage />} />
          <Route path="admin/emprestimos" element={<LoansPage />} />
          <Route path="admin/emprestimos/novo" element={<NewLoanPage />} />
          <Route path="admin/devolucoes" element={<ReturnsPage />} />
          <Route path="admin/devolucoes/:readerId" element={<ReturnDetailPage />} />
          <Route path="admin/reservas" element={<ReservationsPage />} />
          <Route path="admin/leitores" element={<ReadersPage />} />
          <Route path="admin/leitores/:id" element={<ReaderDetailsPage />} />
          <Route path="admin/blocklist" element={<BlockListPage />} />
          <Route element={<RequireAdmin />}>
            <Route path="admin/autores" element={<AuthorsPage />} />
            <Route path="admin/categorias" element={<CategoriesPage />} />
            <Route path="admin/relatorios" element={<ReportsPage />} />
            <Route path="admin/usuarios" element={<UsersPage />} />
            <Route path="admin/configuracoes" element={<SettingsPage />} />
            <Route path="admin/auditoria" element={<AuditPage />} />
            <Route path="admin/backup" element={<BackupsPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
