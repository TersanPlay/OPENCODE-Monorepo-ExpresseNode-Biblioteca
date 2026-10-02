import { api } from '../../services/api-client';
import type { Paginated, User } from '@library/shared';
import type { Params } from '../http';

export const usersApi = {
  list: (params?: Params) => api.get<Paginated<User>>('/users', { params }).then((r) => r.data),
  create: (v: { name: string; email: string; password: string; role: string }) =>
    api.post<User>('/users', v).then((r) => r.data),
  update: (id: number, v: Partial<User> & { password?: string }) =>
    api.put<User>(`/users/${id}`, v).then((r) => r.data),
  deactivate: (id: number) => api.put(`/users/${id}`, { status: 'INACTIVE' }).then((r) => r.data),
  reactivate: (id: number) => api.put(`/users/${id}`, { status: 'ACTIVE' }).then((r) => r.data),
  setSignature: (id: number, signature: string | null) =>
    api.patch<Pick<User, 'id' | 'signature' | 'signatureUpdatedAt'>>(`/users/${id}/signature`, { signature }).then((r) => r.data),
};
