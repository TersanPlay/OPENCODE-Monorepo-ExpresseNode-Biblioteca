import prisma from './prisma';
import type { PrismaClient } from '../generated/prisma';

export interface LibrarySettings {
  loanLimit: number;
  defaultLoanDays: number;
  maxRenewals: number;
  libraryName: string;
  libraryAddress: string | null;
  libraryPhone: string | null;
  libraryEmail: string | null;
  libraryHours: string | null;
}

export async function getSettings(client: PrismaClient = prisma): Promise<LibrarySettings> {
  const s = await client.setting.findUnique({ where: { id: 1 } });
  if (s) {
    return {
      loanLimit: s.loanLimit,
      defaultLoanDays: s.defaultLoanDays,
      maxRenewals: s.maxRenewals,
      libraryName: s.libraryName,
      libraryAddress: s.libraryAddress,
      libraryPhone: s.libraryPhone,
      libraryEmail: s.libraryEmail,
      libraryHours: s.libraryHours,
    };
  }
  return {
    loanLimit: 4,
    defaultLoanDays: 15,
    maxRenewals: 1,
    libraryName: '',
    libraryAddress: null,
    libraryPhone: null,
    libraryEmail: null,
    libraryHours: null,
  };
}