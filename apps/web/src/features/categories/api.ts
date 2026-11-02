import { api } from '../../services/api-client';
import type { Category, Paginated } from '@library/shared';
import type { Params } from '../http';

export const categoriesApi = {
  list: (params?: Params) => api.get<Paginated<Category>>('/categories', { params }).then((r) => r.data),
  all: () => api.get<Paginated<Category>>('/categories', { params: { all: 1 } }).then((r) => r.data.items),
  create: (v: { name: string; description?: string }) =>
    api.post<Category>('/categories', v).then((r) => r.data),
  update: (id: number, v: { name: string; description?: string }) =>
    api.put<Category>(`/categories/${id}`, v).then((r) => r.data),
  deactivate: (id: number) => api.patch(`/categories/${id}/status`, { status: 'INACTIVE' }).then((r) => r.data),
  reactivate: (id: number) => api.patch(`/categories/${id}/status`, { status: 'ACTIVE' }).then((r) => r.data),
};
