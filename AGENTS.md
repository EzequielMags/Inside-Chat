# AGENTS.md — Inside Chat

Regras para todo agente de código neste repositório (Claude Code, Codex ou outro, inclusive rodando pelo Orca). Leia antes de qualquer tarefa.

O Inside Chat é uma caixa de entrada compartilhada para atendimento via **WhatsApp Business Platform (Cloud API oficial)**. Plano, suposições e riscos: `docs/PLANO.md`. Como rodar: `README.md`. O Integgri é só referência conceitual: não copie nome, textos nem interface dele.

## Stack e estrutura

Node 24 executando TypeScript direto (sem build), Fastify + zod, SQLite via `node:sqlite`, SSE, SPA em JS puro.

```
src/app.ts          rotas, auth/CSRF, cabeçalhos de segurança, webhook, SSE
src/domain.ts       regras: ingestão, janela 24 h, envio, permissões, filtros, indicadores
src/channels/       interface Channel + WhatsApp Cloud + Mock
src/db.ts           MIGRATIONS (append-only, PRAGMA user_version), tx(), audit()
src/auth.ts         scrypt, sessões (hash no banco), limitador de login
public/             SPA sem build (h()/textContent, nunca innerHTML)
test/               node:test
```

## Comandos

| Comando | O que faz |
|---|---|
| `npm install` | dependências |
| `npm run seed:demo` | dados de demonstração (só dev) |
| `npm start` / `npm run dev` | sobe em http://localhost:3000 (`dev` com watch) |
| `npm test` | testes |
| `npm run typecheck` | `tsc --noEmit` |
| `node scripts/sync-agents.mjs` | copia `.agents/skills` e `.agents/agents` para `.claude/` |

Use o modo `WA_MODE=mock` (padrão) para desenvolver; nunca chame a Meta real em teste.

## Regras de ouro

1. **Permissão no servidor.** `canAccess` e `accessClause` dizem a mesma coisa; conversa sem acesso → 404.
2. **Toda entrada externa passa por zod** (formulário, query, webhook). SQL só com `?`.
3. **Webhook**: assinatura HMAC sobre o corpo bruto, idempotência por `external_id`, 200 rápido.
4. **Janela de 24 h**: texto livre só dentro dela; fora, apenas template aprovado na Meta.
5. **Nota interna nunca passa pelo `Channel`.**
6. **Segredos só no `.env`/config.** Sem token, senha, telefone ou corpo de mensagem em log, `audit_log` ou resposta de erro (LGPD).
7. **Front sem `innerHTML`.** CSP não pode ser afrouxada.
8. **Migrations append-only** no fim de `MIGRATIONS`.
9. **Poucas dependências** é decisão de projeto; justifique qualquer nova.
10. **Na dúvida sobre regra de negócio, pergunte** e registre a suposição em `docs/PLANO.md`.

## Convenções

- Identificadores em inglês; comentários, mensagens ao usuário, docs e commits em português.
- Commits no formato Conventional Commits (`feat(inbox): ...`, `fix(webhook): ...`).
- Arquivos `kebab-case.ts`; regra de negócio em `domain.ts`, rotas finas em `app.ts`, canal em `src/channels/`.

## Skills (`.agents/skills/`)

| Skill | Quando usar |
|---|---|
| `nova-rota` | criar ou mudar endpoint da API |
| `permissao` | mudar quem vê ou faz o quê (perfis, equipes) |
| `nova-migration` | mudar o schema do SQLite |
| `whatsapp-webhook` | receber eventos da Meta (mensagens, status, tipos novos) |
| `whatsapp-template` | envio, janela de 24 h e templates |
| `novo-canal` | adicionar e-mail, Instagram etc. |
| `frontend-design` | criar ou mudar telas e componentes em `public/` (identidade, estados, acessibilidade, responsivo) |
| `pronto` | Definition of Done antes de concluir ou abrir PR |

## Agents (`.agents/agents/`)

| Agent | Quando usar |
|---|---|
| `arquiteto` | planejar mudança grande antes do código (só leitura) |
| `integrador-meta` | qualquer coisa da WhatsApp Cloud API |
| `revisor-seguranca-lgpd` | revisar diff que toque auth, rotas, webhook ou dados de clientes (só leitura) |
| `testador` | escrever e rodar testes, reproduzir bug |

A fonte é `.agents/`. Depois de editar, rode `node scripts/sync-agents.mjs` e versione as duas pastas.
