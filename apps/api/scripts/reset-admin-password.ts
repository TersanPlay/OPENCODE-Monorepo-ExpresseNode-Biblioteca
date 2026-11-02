import 'dotenv/config';
import prisma from '../src/lib/prisma';
import { env } from '../src/config/env';
import { hashPassword } from '../src/lib/password-hash';

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error('Defina ADMIN_EMAIL e ADMIN_PASSWORD no apps/api/.env');
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new Error(`Usuário não encontrado: ${email}`);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(password, env.PASSWORD_PEPPER),
      status: 'ACTIVE',
    },
  });

  console.log(`Senha do usuário ${email} (${user.role}) redefinida a partir do .env.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());