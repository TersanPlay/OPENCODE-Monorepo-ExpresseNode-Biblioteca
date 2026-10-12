import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[fatal] ${name} ausente — defina no arquivo .env`);
  }
  return value;
}

export const env = {
  get DATABASE_URL(): string {
    return process.env.DATABASE_URL || 'file:./dev.db';
  },
  get JWT_SECRET(): string {
    return required('JWT_SECRET');
  },
  get READER_JWT_SECRET(): string {
    return process.env.READER_JWT_SECRET || `${required('JWT_SECRET')}#reader`;
  },
  get JWT_EXPIRES(): string {
    return process.env.JWT_EXPIRES || '8h';
  },
  get PASSWORD_PEPPER(): string {
    return process.env.PASSWORD_PEPPER?.trim() || `${required('JWT_SECRET')}#pepper`;
  },
  get CORS_ORIGIN(): string[] {
    return (process.env.CORS_ORIGIN || 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  },
  get PORT(): number {
    return Number(process.env.PORT || 3333);
  },
  get NODE_ENV(): string {
    return process.env.NODE_ENV || 'development';
  },
  get SMTP_HOST(): string {
    return process.env.SMTP_HOST?.trim() || 'smtp.zoho.com';
  },
  get SMTP_PORT(): number {
    return Number(process.env.SMTP_PORT || 465);
  },
  get SMTP_USER(): string | null {
    return process.env.ZOHO_EMAIL?.trim() || process.env.SMTP_USER?.trim() || null;
  },
  get SMTP_PASS(): string | null {
    return process.env.ZOHO_APP_PASSWORD?.trim() || process.env.SMTP_PASS?.trim() || null;
  },
  get MAIL_FROM(): string | null {
    return process.env.MAIL_FROM?.trim() || this.SMTP_USER;
  },
  get FRONTEND_URL(): string {
    return (process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim().replace(/\/$/, ''))
      .filter(Boolean)[0] as string;
  },
};

export function jwtSecret(): string {
  return env.JWT_SECRET;
}
