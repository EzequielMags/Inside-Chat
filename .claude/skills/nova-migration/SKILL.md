---
name: nova-migration
description: Cria ou altera tabelas, colunas e índices do banco SQLite do Inside Chat pelo array MIGRATIONS de src/db.ts (versionado por PRAGMA user_version). Use sempre que precisar mudar o schema.
---

# Nova migration

O schema vive em `src/db.ts`, no array `MIGRATIONS`. `openDb` aplica cada item cuja posição é ≥ `PRAGMA user_version`, dentro de uma transação, e incrementa a versão.

## Regras

1. **Append-only.** Nunca edite nem reordene um item existente do array: bancos já criados (`data/cordial.db`, produção) não rodariam a mudança. Sempre **adicione um novo item no fim**.
2. Um item = uma mudança coesa, com comentário SQL dizendo o porquê (`-- v2: ...`).
3. SQLite tem `ALTER TABLE` limitado: `ADD COLUMN` funciona (com `DEFAULT` se `NOT NULL`); mudar `CHECK`, tipo ou remover coluna exige recriar a tabela (`CREATE new` → `INSERT ... SELECT` → `DROP` → `ALTER ... RENAME`), mantendo `foreign_keys` coerentes.
4. Use SQL portável (o plano prevê migrar para Postgres): sem tipos exóticos, datas como texto ISO `strftime('%Y-%m-%dT%H:%M:%fZ','now')`, `CHECK` para enums.
5. Índice para toda coluna usada em filtro/ordenação da inbox (status, assignee, team, datas).
6. Campos com dado pessoal (telefone, conteúdo, e-mail): pergunte-se se são necessários (LGPD, minimização) e anote no `docs/PLANO.md` se mudar o que é guardado.
7. Mudanças de dados sensíveis passam por `audit(db, userId, action, entity, entityId, detail)`; `detail` nunca carrega senha, token nem conteúdo de mensagem.

## Passo a passo

1. Adicione o item ao fim de `MIGRATIONS`.
2. Ajuste `domain.ts`/`app.ts` e os schemas zod das rotas.
3. Ajuste `src/seed-demo.ts` se o seed depender da tabela.
4. Teste em banco novo (`npm test` usa `:memory:`) **e** em banco existente:

   ```powershell
   npm run seed:demo; npm start   # banco antigo recebe só a migration nova
   ```

5. Atualize a seção "Modelo de dados" de `docs/PLANO.md`.
