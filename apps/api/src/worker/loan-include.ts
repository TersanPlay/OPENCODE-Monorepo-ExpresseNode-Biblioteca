/** Include padrão de empréstimo (leitor + livro + responsável) — espelha loan.routes. */
export const loanInclude = {
  reader: true,
  book: true,
  user: { select: { id: true, name: true } },
};
