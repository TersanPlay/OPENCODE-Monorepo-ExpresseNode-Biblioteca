import { useCallback, useEffect, useState, type DependencyList } from 'react';

export function useAsyncData<T>(
  /** Recebe um `AbortSignal` para cancelar a requisição quando as dependências mudam. */
  fetcher: (signal?: AbortSignal) => Promise<T>,
  deps: DependencyList = [],
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    setLoading(true);
    setError(null);
    fetcher(controller.signal)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((err) => {
        // Cancelamento não é erro: a resposta seria descartada de qualquer forma.
        if (!alive || (err as { name?: string })?.name === 'CanceledError') return;
        setError(err instanceof Error ? err.message : 'Erro ao carregar.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [...deps, attempt]);

  const refetch = useCallback(() => setAttempt((a) => a + 1), []);

  return { data, error, loading, refetch };
}
