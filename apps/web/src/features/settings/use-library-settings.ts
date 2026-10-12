import { useEffect, useState } from 'react';
import type { LibrarySettings } from '@library/shared';
import { settingsApi } from '../api';

/**
 * `/settings` era buscado duas vezes por página pública (navbar + rodapé).
 * A promessa é compartilhada em módulo: uma requisição por carregamento,
 * reaproveitada por navbar, rodapé e demais consumidores.
 */
let pending: Promise<LibrarySettings> | null = null;

export function fetchLibrarySettings(): Promise<LibrarySettings> {
  pending ??= settingsApi.get().catch((err) => {
    pending = null; // não guarda erro: a próxima tela tenta de novo
    throw err;
  });
  return pending;
}

/** Chamado após salvar as configurações, para a próxima tela já ler o novo valor. */
export function invalidateLibrarySettings(): void {
  pending = null;
}

export function useLibrarySettings(): LibrarySettings | null {
  const [settings, setSettings] = useState<LibrarySettings | null>(null);

  useEffect(() => {
    let alive = true;
    fetchLibrarySettings()
      .then((s) => {
        if (alive) setSettings(s);
      })
      .catch(() => {
        if (alive) setSettings(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  return settings;
}
