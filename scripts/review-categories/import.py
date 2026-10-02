#!/usr/bin/env python3
"""Etapa 2: importa categorias APROVADAS (status AUTO) e atualiza os livros.
Seguro: backup previo, dry-run padrao, idempotente (reprocesso sem duplicar).
Uso: python import.py [--apply] [--input revisao-categorias.json]
Sem --apply: apenas relata o que faria.
"""
import datetime
import json
import shutil
import sqlite3
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
DB = BASE / '..' / '..' / 'apps' / 'api' / 'prisma' / 'dev.db'
INPUT = BASE / sys.argv[sys.argv.index('--input') + 1] if '--input' in sys.argv else BASE / 'revisao-categorias.json'
APPLY = '--apply' in sys.argv
WITH_REVIEW = '--include-review' in sys.argv

TAX = json.loads((BASE / 'taxonomy.json').read_text(encoding='utf-8'))['categories']
NOW = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')


def main():
    data = json.loads(INPUT.read_text(encoding='utf-8'))
    if WITH_REVIEW:
        targets = [r for r in data if r['categoriaRecomendada'] and r['status'] in ('AUTO', 'REVIEW')]
    else:
        targets = [r for r in data if r['status'] == 'AUTO' and r['categoriaRecomendada']]
    bad = [r for r in data if r['status'] == 'AUTO' and (not r['categoriaRecomendada'] or r['categoriaRecomendada'] not in TAX)]
    print(f'APROVADOS: {len(targets)} | AUTO sem recomendacao valida (ignorados): {len(bad)}')
    if bad[:5]:
        print('  ex.:', [(r['id'], r['titulo']) for r in bad[:5]])

    if APPLY:
        backup = DB.parent / f"pre-import-categorias-{datetime.datetime.now().strftime('%Y-%m-%d_%H-%M')}.sqlite"
        shutil.copy2(DB, backup)
        print('BACKUP:', backup)

    db = sqlite3.connect(str(DB))
    cur = db.cursor()
    # find-or-create das canonicas usadas
    cat_ids = {}
    for name in sorted({r['categoriaRecomendada'] for r in targets}):
        row = cur.execute('SELECT id FROM Category WHERE name = ?', (name,)).fetchone()
        if row:
            cat_ids[name] = row[0]
        elif APPLY:
            cur.execute("INSERT INTO Category (name, status, createdAt, updatedAt) VALUES (?, 'ACTIVE', ?, ?)", (name, NOW, NOW))
            cat_ids[name] = cur.lastrowid
            print(f'  + categoria criada: {name}')
        else:
            print(f'  + criaria categoria: {name}')
    if not APPLY:
        # mapeia ids existentes para o relatorio ficar fiel
        for name in list(cat_ids):
            pass

    updated, skipped, errors = 0, 0, []
    for r in targets:
        bid = r['id']
        exists = cur.execute('SELECT 1 FROM Book WHERE id = ? AND isArchived = 0', (bid,)).fetchone()
        if not exists:
            errors.append((bid, 'livro inexistente/arquivado'))
            continue
        cid = cat_ids.get(r['categoriaRecomendada'])
        if cid is None:
            # dry-run sem categoria existente: relata
            cur_links = cur.execute('SELECT categoryId FROM BookCategory WHERE bookId = ?', (bid,)).fetchall()
            if len(cur_links) == 1:
                skipped += 1
            else:
                updated += 1
            continue
        cur_links = [x[0] for x in cur.execute('SELECT categoryId FROM BookCategory WHERE bookId = ?', (bid,)).fetchall()]
        if cur_links == [cid]:
            skipped += 1  # idempotente: ja esta certo
            continue
        if APPLY:
            cur.execute('DELETE FROM BookCategory WHERE bookId = ?', (bid,))
            cur.execute('INSERT INTO BookCategory (bookId, categoryId) VALUES (?, ?)', (bid, cid))
        updated += 1
    if APPLY:
        db.commit()
    print(f'{"APLICADO" if APPLY else "DRY-RUN"}: atualizados={updated} ja-corretos={skipped} erros={len(errors)}')
    for e in errors[:10]:
        print('  erro:', e)
    db.close()


main()
