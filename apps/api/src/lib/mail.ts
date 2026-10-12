import { createTransport, type Transporter } from 'nodemailer';
import { env } from '../config/env';
import { passwordResetEmail } from './mail-content';

export { passwordResetEmail };

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  const user = env.SMTP_USER;
  const pass = env.SMTP_PASS;
  if (!user || !pass) {
    throw new Error('[email] ZOHO_EMAIL e ZOHO_APP_PASSWORD ausentes — defina no arquivo .env');
  }
  if (!transporter) {
    const port = env.SMTP_PORT;
    transporter = createTransport({
      host: env.SMTP_HOST,
      port,
      // Zoho: 465 = SSL implícito; 587 = STARTTLS.
      secure: port === 465,
      auth: { user, pass },
    });
  }
  return transporter;
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const from = env.MAIL_FROM;
  if (!from) {
    throw new Error('[email] MAIL_FROM ausente — defina no arquivo .env');
  }
  await getTransporter().sendMail({
    from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });
}
