import type {
  CatalogUpdateAnalysis,
  CatalogUpdateJobSummary,
  CatalogUpdateRow,
} from '@library/shared';
import { api } from '../../services/api-client';
import type { Params } from '../http';

export type CatalogUpdatePage<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type CatalogReportKind = 'livros-sem-isbn' | 'isbns-invalidos';

export interface CatalogReport {
  filename: string;
  title: string;
  total: number;
  generatedAt: string;
  markdown: string;
}

export interface SimulationInput {
  limit?: number | null;
  delayMs?: number;
  bookIds?: number[];
}

export const catalogUpdateApi = {
  analysis: () =>
    api.get<CatalogUpdateAnalysis>('/catalog-update/analysis').then((r) => r.data),

  books: (params: Params) =>
    api
      .get<CatalogUpdatePage<CatalogUpdateRow>>('/catalog-update/books', { params })
      .then((r) => r.data),

  simulate: (body: SimulationInput) =>
    api
      .post<{ job: CatalogUpdateJobSummary }>('/catalog-update/simulate', body)
      .then((r) => r.data.job),

  apply: (simulationId: string) =>
    api
      .post<{ job: CatalogUpdateJobSummary }>('/catalog-update/apply', {
        simulationId,
        confirm: true,
      })
      .then((r) => r.data.job),

  job: (id: string) =>
    api
      .get<{ job: CatalogUpdateJobSummary }>(`/catalog-update/jobs/${id}`)
      .then((r) => r.data.job),

  stopJob: (id: string) =>
    api
      .post<{ job: CatalogUpdateJobSummary }>(`/catalog-update/jobs/${id}/stop`)
      .then((r) => r.data.job),

  jobRows: (id: string, params: Params) =>
    api
      .get<CatalogUpdatePage<CatalogUpdateRow>>(`/catalog-update/jobs/${id}/rows`, {
        params,
      })
      .then((r) => r.data),

  report: (kind: CatalogReportKind) =>
    api.get<CatalogReport>(`/catalog-update/reports/${kind}`).then((r) => r.data),

  downloadReport: async (kind: CatalogReportKind, filename: string) => {
    const res = await api.get(`/catalog-update/reports/${kind}`, {
      params: { download: 1 },
      responseType: 'blob',
    });
    const url = URL.createObjectURL(res.data as Blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  },
};