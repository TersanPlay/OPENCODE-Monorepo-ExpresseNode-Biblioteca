import { api } from '../../services/api-client';
import type { ReportResult, ReportType } from '@library/shared';
import type { Params } from '../http';

export const reportsApi = {
  generate: (type: ReportType, params?: Params) =>
    api.get<ReportResult>('/reports', { params: { type, ...params } }).then((r) => r.data),
  exportPdf: async (type: ReportType, params?: Params): Promise<void> => {
    const res = await api.get('/reports/export-pdf', { params: { type, ...params }, responseType: 'blob' });
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio-${type}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
};
