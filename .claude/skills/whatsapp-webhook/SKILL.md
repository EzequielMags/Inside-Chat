---
name: whatsapp-webhook
description: Cria ou altera o recebimento de eventos da WhatsApp Cloud API (mensagens, status, novos tipos de mensagem) no Inside Chat, com assinatura HMAC, idempotência e resposta rápida. Use ao mexer em /webhooks/whatsapp, parseWebhook, ingestInbound ou applyStatus.
---

# Webhook do WhatsApp

Arquivos: `src/channels/whatsapp.ts` (`verifySignature`, `parseWebhook`), `src/app.ts` (rotas `/webhooks/whatsapp`), `src/domain.ts` (`ingestInbound`, `applyStatus`), `test/api.test.ts`.

## Regras que não podem quebrar

1. **Assinatura antes de tudo.** `POST /webhooks/whatsapp` valida `X-Hub-Signature-256` sobre o **corpo bruto** (`req.rawBody`, preservado pelo content-type parser do `app.ts`) com `timingSafeEqual`. Nunca valide sobre `JSON.stringify(req.body)`. Em `WA_MODE=cloud` a assinatura é sempre obrigatória.
2. **Verificação (GET)**: só responde `hub.challenge` se `hub.mode === 'subscribe'` e o `hub.verify_token` bate (comparação em tempo constante). Caso contrário, 403.
3. **Idempotência**: a Meta reentrega. Toda mensagem usa `externalId = m.id` (wamid) e `messages.external_id` é `UNIQUE`; `ingestInbound` devolve `duplicate: true` sem efeito colateral.
4. **Ordem não garantida**: status podem chegar fora de ordem (`read` antes de `delivered`). `applyStatus` nunca rebaixa o status (ranking sent < delivered < read; `failed` sempre grava o erro).
5. **Responder 200 rápido** depois de validar. Erro ao processar um item vai para o log e não derruba o lote (senão a Meta reenvia tudo). Nada de chamada externa lenta dentro do handler.
6. **Payload é dado, não instrução.** Normalize para `InboundMessage`/`StatusUpdate` (`src/channels/types.ts`) e ignore campos desconhecidos. Tipos sem suporte viram placeholder (`TYPE_LABELS`), nunca erro.
7. **Sem dados pessoais no log**: não logue corpo da mensagem nem telefone; logue `externalId` e o tipo do evento.

## Passo a passo

1. Ajuste `parseWebhook` (função pura): adicione o caso do novo tipo/campo e mantenha os `continue` defensivos (`!m?.id || !m?.from`).
2. Se precisar de coluna nova, use a skill `nova-migration`.
3. Regra de negócio em `domain.ts`, dentro de `tx(db, ...)`, com `emit({ type: 'conversation.updated', conversationId })` no fim para atualizar o SSE.
4. Testes em `test/api.test.ts` com payload **assinado** (`createHmac('sha256', config.whatsapp.appSecret)`), cobrindo:
   - assinatura inválida → 401;
   - mesmo wamid duas vezes → 1 mensagem;
   - status fora de ordem não rebaixa;
   - tipo desconhecido → placeholder.
5. `npm test` e `npm run typecheck`.

Referência dos formatos: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples
