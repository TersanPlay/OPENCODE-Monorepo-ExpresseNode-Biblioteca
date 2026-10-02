#!/usr/bin/env python3
"""Remove categorias LEGADAS (fora da taxonomia canonica) do banco.
Consistente: apaga primeiro os vinculos BookCategory, depois as categorias.
Seguro: backup previo, dry-run padrao, idempotente.
Uso: python cleanup-legacy.py [--apply]
"""
import datetime
import json
import shutil
import sqlite3
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
DB = BASE / '..' / '..' / 'apps' / 'api' / 'prisma' / 'dev.db'
APPLY = '--apply' in sys.argv

TAX = set(json.loads((BASE / 'taxonomy.json').read_text(encoding='utf-8'))['categories'])


def main():
    db = sqlite3.connect(str(DB))
    cur = db.cursor()
    rows = cur.execute('SELECT id, name FROM Category').fetchall()
    legacy = [(i, n) for i, n in rows if n not in TAX]
    print(f'CATEGORIAS: total={len(rows)} legadas={len(legacy)} canonicas={len(rows) - len(legacy)}')
    if not legacy:
        print('Nada a remover (idempotente).')
        return
    ids = [i for i, _ in legacy]
    q = ','.join('?' * len(ids))
    n_links = cur.execute(f'SELECT COUNT(*) FROM BookCategory WHERE categoryId IN ({q})', ids).fetchone()[0]
    n_books = cur.execute(f'SELECT COUNT(DISTINCT bookId) FROM BookCategory WHERE categoryId IN ({q})', ids).fetchone()[0]
    print(f'VINCULOS-LEGADOS: {n_links} em {n_books} livros (serao removidos; livros mantem as canonicas que tiverem)')
    if not APPLY:
        print('DRY-RUN: nada alterado. Rode com --apply.')
        return
    backup = DB.parent / f"pre-cleanup-legadas-{datetime.datetime.now().strftime('%Y-%m-%d_%H-%M')}.sqlite"
    shutil.copy2(DB, backup)
    print('BACKUP:', backup)
    cur.execute(f'DELETE FROM BookCategory WHERE categoryId IN ({q})', ids)
    cur.execute(f'DELETE FROM Category WHERE id IN ({q})', ids)
    db.commit()
    print(f'APLICADO: {len(legacy)} categorias e {n_links} vinculos removidos.')
    print('RESTAM:', cur.execute('SELECT COUNT(*) FROM Category').fetchone()[0], 'categorias.')
    db.close()


main()
