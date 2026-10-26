---
name: novo-canal
description: Adiciona um novo canal de atendimento ao Inside Chat (e-mail, Instagram, Telegram, chat do site) implementando a interface Channel e um parser de webhook, sem mexer na inbox. Use quando o pedido for "integrar canal X" ou "receber mensagens de X".
---

# Novo canal

A arquitetura foi feita para isso: a inbox não conhece o WhatsApp, só `Channel`, `InboundMessage` e `StatusUpdate` (`src/channels/types.ts`). Tabelas já têm a coluna `conversations.channel`.

## Antes de começar

Confirme com o usuário: canal **oficial** (API do provedor, sem automação de app pessoal), credenciais disponíveis, se o canal tem regra parecida com a janela de 24 h e se o identificador do cliente é telefone, e-mail ou id do provedor. Se não for telefone, a tabela `customers` precisa de um identificador por canal: pare e proponha a migration antes.

## Passo a passo

1. `src/channels/<canal>.ts` com:
   - `verify<Canal>Signature(rawBody, header, secret)` (HMAC/assinatura do provedor, tempo constante);
   - `parse<Canal>Webhook(payload)` → `{ messages: InboundMessage[]; statuses: StatusUpdate[] }`, função pura;
   - `class <Canal>Channel implements Channel` com `name = '<canal>'`, `fetch` com `AbortSignal.timeout(15_000)` e erro sem vazar token;
   - versão mock para dev e testes.
2. Config em `src/config.ts` (+ `.env.example` com valores vazios). Validar no `buildApp` que o modo real tem todas as variáveis.
3. Rota de webhook em `src/app.ts` seguindo o padrão do WhatsApp (ver skill `whatsapp-webhook`): corpo bruto, assinatura, 200 rápido, erros por item no log.
4. Hoje `buildApp` recebe **um** `channel`. Com dois canais, troque para um registro `Record<string, Channel>` e escolha por `conv.channel` em `sendMessage`. Faça essa refatoração num passo separado, com testes passando antes de adicionar o canal.
5. Front (`public/app.js`): só um ícone/rótulo do canal na lista. Regras de envio específicas ficam no backend.
6. Testes: parser com payload de exemplo, assinatura inválida → 401, idempotência, envio via mock.
7. Documente o canal no `README.md` (como conectar) e em `docs/PLANO.md` (decisões/limites).

## Não fazer

- Lógica do canal dentro de `domain.ts` ou da inbox.
- Biblioteca não oficial que automatiza app pessoal (viola termos e derruba número/conta).
