-- Controle persistente da atualização cadastral (ISBNdb).
-- Colunas aditivas: nenhum registro existente é alterado; livros antigos
-- permanecem com status NULL (pendentes) até um processamento bem-sucedido.
ALTER TABLE "Book" ADD COLUMN "catalogUpdateStatus" TEXT;
ALTER TABLE "Book" ADD COLUMN "catalogUpdatedAt" DATETIME;
ALTER TABLE "Book" ADD COLUMN "catalogUpdateSource" TEXT;
ALTER TABLE "Book" ADD COLUMN "catalogUpdateMessage" TEXT;
ALTER TABLE "Book" ADD COLUMN "catalogUpdateFields" TEXT;
ALTER TABLE "Book" ADD COLUMN "catalogUpdateJobId" TEXT;

CREATE INDEX "Book_catalogUpdateStatus_idx" ON "Book"("catalogUpdateStatus");