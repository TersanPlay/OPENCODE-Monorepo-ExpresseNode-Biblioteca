/**
 * Senhas com PBKDF2-SHA256 via WebCrypto (Node 18+ e Workers) + pepper (HMAC).
 * ~5ms — cabe no CPU do plano Free. Formato versionado p/ upgrades futuros:
 * `$pbkdf2$<versão>$<iterações>$<salt b64u>$<hash b64u>`.
 *
 * Hashes bcrypt legados (`$2b$…`): no Worker não há CPU p/ verificar —
 * `verifyPassword` retorna `'legacy'` e o login orienta a redefinição.
 * Fora do Worker (dev local), o bcrypt é conferido de verdade.
 */
import bcrypt from 'bcryptjs';

const VERSION = 1;
const ITERATIONS = 10_000;
const SALT_BYTES = 16;
const PREFIX = '$pbkdf2$';

function b64uEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64uDecode(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function isWorkersRuntime(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers';
}

async function pbkdf2(
  password: string,
  pepper: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const inner = await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(password));
  const key = await crypto.subtle.importKey('raw', inner, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(plain: string, pepper: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await pbkdf2(plain, pepper, salt, ITERATIONS);
  return `${PREFIX}${VERSION}$${ITERATIONS}$${b64uEncode(salt)}$${b64uEncode(hash)}`;
}

export type VerifyResult = 'valid' | 'invalid' | 'legacy';

export async function verifyPassword(
  plain: string,
  stored: string,
  pepper: string,
): Promise<VerifyResult> {
  if (!stored.startsWith(PREFIX)) {
    if (isWorkersRuntime()) return 'legacy';
    try {
      return (await bcrypt.compare(plain, stored)) ? 'valid' : 'invalid';
    } catch {
      return 'invalid';
    }
  }
  const parts = stored.split('$');
  // ['', 'pbkdf2', versão, iterações, salt, hash]
  if (parts.length !== 6 || parts[1] !== 'pbkdf2') return 'invalid';
  const iterations = Number(parts[3]);
  if (!Number.isInteger(iterations) || iterations <= 0 || iterations > 1_000_000) return 'invalid';
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = b64uDecode(parts[4]);
    expected = b64uDecode(parts[5]);
  } catch {
    return 'invalid';
  }
  const actual = await pbkdf2(plain, pepper, salt, iterations);
  if (actual.length !== expected.length) return 'invalid';
  // Comparação em tempo constante.
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0 ? 'valid' : 'invalid';
}

/** Hash de comparação p/ usuário inexistente (timing) — nunca corresponde a senha alguma. */
export const DUMMY_PASSWORD_HASH =
  '$pbkdf2$1$10000$ZzaenSCrteWCVacYEN6ALg$tk1-0L23o3UPvNC7p_zxEpUL3_JphsibmFP5gJDvaos';

/** Hash com parâmetros defasados — ou legado (re-hash transparente no próximo login válido). */
export function needsRehash(stored: string): boolean {
  if (!stored.startsWith(PREFIX)) return true;
  const parts = stored.split('$');
  return !(parts[2] === String(VERSION) && parts[3] === String(ITERATIONS));
}
