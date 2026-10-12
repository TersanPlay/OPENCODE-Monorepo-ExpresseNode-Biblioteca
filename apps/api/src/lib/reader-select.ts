/**
 * Projeções explícitas de `Reader`.
 *
 * Motivos para não usar `include: { reader: true }`:
 * 1. Segurança: `reader: true` devolvia `passwordHash` (hash PBKDF2) nas respostas
 *    de /api/loans e /api/readers.
 * 2. Peso: `signature` e `rubricImage` são PNG em base64 (~68 KB + ~17 KB por
 *    leitor). Lê-los do D1 só para descartar depois domina o tempo das listagens.
 *
 * `readerListSelect` mantém `signature` de propósito: o formulário de empréstimo
 * (`new-loan.tsx`) reaproveita a assinatura salva do leitor a partir da busca.
 * `readerEmbedSelect` é para leitores embutidos em listas, onde a imagem nunca é
 * exibida.
 */
import type { Prisma } from '../generated/prisma';

/** Leitor embutido em empréstimo/devolução: sem imagens e sem credencial. */
export const readerEmbedSelect = {
  id: true,
  name: true,
  cpf: true,
  birthDate: true,
  phone: true,
  email: true,
  cep: true,
  address: true,
  number: true,
  neighborhood: true,
  city: true,
  state: true,
  status: true,
  deletedAt: true,
  anonymizedAt: true,
  blockReason: true,
  blockCategory: true,
  blockedAt: true,
  blockedBy: true,
  signatureUpdatedAt: true,
  signatureType: true,
  signatureText: true,
  rubricText: true,
  fontFamily: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ReaderSelect;

/** Listagem de leitores: igual ao embed + `signature` (reaproveitada no empréstimo). */
export const readerListSelect = {
  ...readerEmbedSelect,
  signature: true,
} satisfies Prisma.ReaderSelect;
