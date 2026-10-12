import axios from 'axios';

/**
 * URL base da API. Ordem: env de build (dev/local) > constante de runtime em
 * `index.html` (produção) > `/api` relativo (fallback do dev, via proxy do
 * Vite). Em produção a constante de runtime vence, então um rebuild feito sem
 * `VITE_API_URL` não quebra o deploy.
 */
function resolveBaseUrl(): string {
  return (
    import.meta.env.VITE_API_URL ||
    (import.meta.env.PROD ? window.__API_BASE_URL__ : undefined) ||
    '/api'
  );
}

const baseURL = resolveBaseUrl();

export const api = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
});

const TOKEN_KEY = 'livraria_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401 && !error.config?.url?.includes('/auth/login')) {
      setToken(null);
      window.dispatchEvent(new Event('auth:unauthorized'));
    }
    return Promise.reject(error);
  },
);

// --- Portal do leitor: instância isolada (token e sessão próprios) ---
export const apiReader = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
});

const READER_TOKEN_KEY = 'livraria_reader_token';

export function getReaderToken(): string | null {
  return localStorage.getItem(READER_TOKEN_KEY);
}

export function setReaderToken(token: string | null): void {
  if (token) localStorage.setItem(READER_TOKEN_KEY, token);
  else localStorage.removeItem(READER_TOKEN_KEY);
}

apiReader.interceptors.request.use((config) => {
  const token = getReaderToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

apiReader.interceptors.response.use(
  (response) => response,
  (error) => {
    const url: string = error.config?.url ?? '';
    if (
      error?.response?.status === 401 &&
      !url.includes('/readers/login') &&
      !url.includes('/readers/register')
    ) {
      setReaderToken(null);
      window.dispatchEvent(new Event('reader:unauthorized'));
    }
    return Promise.reject(error);
  },
);
