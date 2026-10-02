import { apiReader } from '../../services/api-client';
import type { Loan, Reader, Reservation } from '@library/shared';

export interface ReaderLoans {
  loans: Loan[];
  activeLoans: Loan[];
  overdueCount: number;
}

export const readerPortalApi = {
  register: (v: Record<string, unknown>) =>
    apiReader.post<{ token: string; reader: Reader }>('/readers/register', v).then((r) => r.data),
  login: (email: string, password: string) =>
    apiReader.post<{ token: string; reader: Reader }>('/readers/login', { email, password }).then((r) => r.data),
  claim: (cpf: string, email: string, password: string) =>
    apiReader.post<{ token: string; reader: Reader }>('/readers/claim', { cpf, email, password }).then((r) => r.data),
  me: () => apiReader.get<{ reader: Reader }>('/readers/me').then((r) => r.data.reader),
  updateMe: (v: Record<string, unknown>) =>
    apiReader.put<{ reader: Reader }>('/readers/me', v).then((r) => r.data.reader),
  changePassword: (currentPassword: string, password: string) =>
    apiReader.post<{ ok: boolean }>('/readers/me/password', { currentPassword, password }).then((r) => r.data),
  setMySignature: (signature: string) =>
    apiReader.patch<{ reader: Reader }>('/readers/me/signature', { signature }).then((r) => r.data.reader),
  deleteMySignature: () =>
    apiReader.delete<{ reader: Reader }>('/readers/me/signature').then((r) => r.data.reader),
  myLoans: () => apiReader.get<ReaderLoans>('/readers/me/loans').then((r) => r.data),
  myReservations: () =>
    apiReader.get<{ reservations: Reservation[] }>('/readers/me/reservations').then((r) => r.data.reservations),
  reserve: (bookId: number) =>
    apiReader.post<Reservation>('/readers/me/reservations', { bookId }).then((r) => r.data),
  cancelReservation: (id: number) =>
    apiReader.post<Reservation>(`/readers/me/reservations/${id}/cancel`).then((r) => r.data),
  getTerm: async (id: number): Promise<Blob> => {
    const res = await apiReader.get(`/loans/${id}/term`, { responseType: 'blob' });
    return res.data as Blob;
  },
  getReturnTerm: async (id: number): Promise<Blob> => {
    const res = await apiReader.get(`/loans/${id}/return-term`, { responseType: 'blob' });
    return res.data as Blob;
  },
  openTerm: async (id: number) => {
    const blob = await readerPortalApi.getTerm(id);
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
  openReturnTerm: async (id: number) => {
    const blob = await readerPortalApi.getReturnTerm(id);
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
};
