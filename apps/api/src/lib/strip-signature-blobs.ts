/**
 * Assinaturas e rubricas são armazenadas como PNG em base64 (~70–130 KB por
 * registro). Respostas de listagem não precisam delas — só os formulários de
 * empréstimo/devolução e a tela de detalhe exibem. Sem esta remoção, uma
 * página com 5 itens chega a >1 MB.
 *
 * Use apenas em listagens; detalhe (`/loans/:id`, devolução) precisa das
 * assinaturas.
 */

type Blob = Record<string, unknown>;

export function stripReaderBlobs<T extends Blob>(reader: T): Omit<T, 'signature' | 'rubricImage'> {
  const { signature: _signature, rubricImage: _rubricImage, ...rest } = reader;
  return rest;
}

export function stripLoanBlobs<T extends Blob>(loan: T) {
  const {
    loanSignature: _loanSignature,
    returnSignature: _returnSignature,
    createdBySignatureSnapshot: _createdBySignatureSnapshot,
    receivedBySignatureSnapshot: _receivedBySignatureSnapshot,
    reader,
    ...rest
  } = loan;
  return {
    ...rest,
    ...(reader ? { reader: stripReaderBlobs(reader as Blob) } : {}),
  };
}

export function stripLoanBlobsMany<T extends Blob>(loans: T[]) {
  return loans.map(stripLoanBlobs);
}