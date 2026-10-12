import { HttpError } from '../lib/http-error';
import { passwordResetEmail } from '../lib/mail-content';
import type { WorkerEnv } from './env';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export { passwordResetEmail };

/**
 * Envio via Email Sending da Cloudflare (binding `EMAIL`, sem chaves).
 * O remetente precisa ser de um domínio habilitado no Email Service.
 *
 * O envio é opcional: sem o binding `EMAIL` ou sem `MAIL_FROM` a API responde
 * 503 com mensagem explícita em vez de tentar enviar. Para (re)ativar, acrescente
 * o binding `"send_email": [{ "name": "EMAIL" }]` e a var `MAIL_FROM` em
 * `wrangler.jsonc`, com o domínio habilitado no Email Service.
 */
export async function sendEmail(env: WorkerEnv, input: SendEmailInput): Promise<void> {
  if (!env.EMAIL) {
    throw new HttpError(503, 'Envio de e-mail desabilitado nesta instalação.');
  }
  const from = env.MAIL_FROM?.trim();
  if (!from) {
    throw new HttpError(503, 'Remetente não configurado (MAIL_FROM). Contate o administrador.');
  }
  try {
    await env.EMAIL.send({
      to: input.to,
      from,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[email] falha no envio:', code, detail);
    if (code === 'E_SENDER_NOT_VERIFIED' || code === 'E_SENDER_DOMAIN_NOT_AVAILABLE') {
      throw new HttpError(503, 'Domínio remetente não habilitado para envio.');
    }
    throw new HttpError(503, 'Não foi possível enviar o e-mail. Tente novamente.');
  }
}
