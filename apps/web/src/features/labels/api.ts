import { api } from '../../services/api-client';

export const labelsApi = {
  generatePdf: async (bookId: number, exemplares: number[]): Promise<void> => {
    const res = await api.post('/labels/pdf', { bookId, exemplares }, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `etiquetas-livro-${bookId}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
};
