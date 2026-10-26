---
name: nova-rota
description: Cria ou altera um endpoint da API do Inside Chat (Fastify) no padrão do projeto - sessão, CSRF, validação zod, permissão, HttpError, auditoria e evento SSE. Use ao adicionar ou mudar qualquer rota em src/app.ts.
---

# Nova rota da API

## O que já é automático (não duplique)

- `preHandler` em `/api/*`: exige header `X-Requested-With: cordial` em métodos de escrita (CSRF) e carrega `req.user` da sessão; sem sessão → 401. Exceção: `/api/auth/login`.
- `setErrorHandler`: `HttpError` → `{ error, code }` com o status dela; `ZodError` → 400 `validation`; resto → 500 "Erro interno" (detalhe só no log).
- Cabeçalhos de segurança e `Cache-Control: no-store` para `/api`.

## Padrão de uma rota

```ts
app.patch('/api/coisas/:id', async (req) => {
  const user = admin(req);                 // ou me(req) + checagem de acesso
  const cid = id.parse((req.params as any).id);
  const b = z.object({ name: z.string().trim().min(1).max(120) }).strict().parse(req.body);
  const row = tx(db, () => { /* ... */ });
  audit(db, user.id, 'coisa.update', 'coisa', cid, { fields: Object.keys(b) });
  emit({ type: 'conversation.updated', conversationId }); // se afeta a inbox
  return row;
});
```

## Regras

1. **Toda entrada passa por zod** (`params`, `query`, `body`), com limites de tamanho. Use `.strict()` em bodies de escrita.
2. **Permissão no servidor, sempre** (ver skill `permissao`). O front esconder um botão não é proteção.
3. Conversa de outra equipe responde **404**, não 403 (`getConversationFor`), para não revelar que existe.
4. Regra de negócio vai para `src/domain.ts`; a rota só valida, chama e responde.
5. Escrita relevante gera `audit(...)`. Nunca coloque senha, token ou corpo de mensagem em `detail` (veja `user.update`, que mascara a senha).
6. Mensagens de erro em pt-BR, curtas, sem detalhe interno (SQL, stack, resposta da Meta crua).
7. SQL sempre com `?` (prepared statements). Nunca interpole valor do usuário; para listas, gere placeholders como em `accessClause`.
8. Listagens têm `LIMIT`.
9. Front (`public/app.js`): chame via `api(method, url, body)` e monte o DOM com `h(...)`/`textContent`. **Nunca `innerHTML`.**

## Teste

Em `test/api.test.ts`, use `call(email, method, url, payload)`:
- caminho feliz;
- 400 com body inválido;
- 401 sem sessão;
- 403/404 para agente sem acesso;
- registro em `audit_log` quando aplicável.
