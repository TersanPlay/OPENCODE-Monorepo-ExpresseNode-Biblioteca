import { api } from '../../services/api-client';
import type { Paginated, SignatureType, User } from '@library/shared';
import type { Params } from '../http';

export interface SignaturePayload {
  signature: string | null;
  signatureType?: SignatureType | null;
  signatureText?: string | null;
  rubricText?: string | null;
  rubricImage?: string | null;
  fontFamily?: string | null;
}

export type UserSignaturePatch = Pick<User, 'id' | 'signature' | 'signatureUpdatedAt' | 'signatureType' | 'signatureText' | 'rubricText' | 'rubricImage' | 'fontFamily'>;

export const usersApi = {
  list: (params?: Params) => api.get<Paginated<User>>('/users', { params }).then((r) => r.data),
  get: (id: number) => api.get<User>(`/users/${id}`).then((r) => r.data),
  getMe: () => api.get<User>('/users/me').then((r) => r.data),
  create: (v: { name: string; email: string; password: string; role: string }) =>
    api.post<User>('/users', v).then((r) => r.data),
  update: (id: number, v: Partial<User> & { password?: string }) =>
    api.put<User>(`/users/${id}`, v).then((r) => r.data),
  deactivate: (id: number) => api.put(`/users/${id}`, { status: 'INACTIVE' }).then((r) => r.data),
  reactivate: (id: number) => api.put(`/users/${id}`, { status: 'ACTIVE' }).then((r) => r.data),
  setSignature: (id: number, v: SignaturePayload) =>
    api.patch<UserSignaturePatch>(`/users/${id}/signature`, v).then((r) => r.data),
  patchMeSignature: (v: SignaturePayload) =>
    api.patch<UserSignaturePatch>('/users/me/signature', v).then((r) => r.data),
};
