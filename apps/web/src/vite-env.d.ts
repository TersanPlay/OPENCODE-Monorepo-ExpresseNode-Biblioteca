/// <reference types="vite/client" />

export {};

/** URL base da API injetada em `index.html` (runtime, independe de build). */
declare global {
  interface Window {
    __API_BASE_URL__?: string;
  }
}
