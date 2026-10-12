/** Conteúdo do e-mail de recuperação — puro, sem transporte (usado por Express e Worker). */
export function passwordResetEmail(
  name: string | null,
  link: string,
): { subject: string; html: string; text: string } {
  const greeting = name ? `Olá, ${name.split(' ')[0]}.` : 'Olá.';
  const subject = 'Recuperação de senha';
  const text =
    `${greeting}\n\n` +
    `Recebemos um pedido de recuperação de senha para sua conta.\n` +
    `Acesse o link abaixo em até 1 hora para definir uma nova senha:\n\n${link}\n\n` +
    `Se você não fez esse pedido, ignore este e-mail.`;
  const html =
    `<p>${greeting}</p>` +
    `<p>Recebemos um pedido de recuperação de senha para sua conta.</p>` +
    `<p><a href="${link}">Definir nova senha</a> (válido por 1 hora).</p>` +
    `<p>Se você não fez esse pedido, ignore este e-mail.</p>`;
  return { subject, html, text };
}
