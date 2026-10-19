---
name: permissao
description: Regras de controle de acesso do Cordial (perfis admin/agent, equipes, quem vê e altera cada conversa). Use ao criar perfil novo (ex. supervisor), mudar visibilidade de conversas, filtros, indicadores ou qualquer rota que exponha dados de clientes.
---

# Permissões

Fonte: `src/domain.ts` (`canAccess`, `accessClause`, `getConversationFor`), `admin()` em `src/app.ts`, `SessionUser` em `src/auth.ts`.

## Regra atual

| Perfil | Vê / age em |
|---|---|
| `admin` | tudo; único que gerencia usuários, equipes, templates, auditoria e simulador |
| `agent` | conversas atribuídas a ele **ou** de uma equipe dele **ou** sem dono e sem equipe |

## Invariantes

1. **`canAccess` (uma linha) e `accessClause` (SQL de listagem) precisam dizer exatamente a mesma coisa.** Mudou um, mude o outro e teste os dois caminhos (abrir por id e aparecer na lista).
2. Todo acesso a conversa por id passa por `getConversationFor` (404 se não pode ver).
3. Indicadores (`metrics`), busca, clientes e histórico também respeitam `accessClause`: agente não pode descobrir conversa alheia por filtro, busca ou contagem.
4. Rotas de administração começam com `admin(req)`.
5. Usuário inativo (`active = 0`) perde a sessão; mudança de papel ou equipe vale na próxima requisição (o `SessionUser` é recarregado do banco).
6. Notas internas são visíveis para quem acessa a conversa, e **nunca** saem pelo canal.
7. Mudanças de papel, equipe e atribuição vão para `audit_log`.

## Ao mudar a regra

- A decisão é de produto. Se o pedido não deixa claro quem pode o quê, **pergunte** e registre a resposta na tabela de suposições de `docs/PLANO.md`.
- Escreva primeiro o teste de "não pode" (agente da equipe B não vê conversa da equipe A: lista, `GET /:id`, `PATCH`, mensagens, métricas), depois o de "pode".
- Rode o agent `revisor-seguranca-lgpd` no diff.
