---
name: whatsapp-template
description: Regras de envio do WhatsApp no Inside Chat - janela de 24 h, templates aprovados pela Meta, parâmetros, categorias e falhas de envio. Use ao mexer em sendMessage, windowInfo, renderTemplate, na tela de templates ou em qualquer envio iniciado pela empresa.
---

# Envio: janela de 24 h e templates

Arquivos: `src/domain.ts` (`windowInfo`, `renderTemplate`, `sendMessage`), `src/channels/whatsapp.ts` (`sendText`, `sendTemplate`), rotas `/api/templates` e `/api/conversations/:id/messages` em `src/app.ts`.

## Regras da Meta (o app deve garantir)

- **Texto livre só dentro da janela de 24 h** contada da última mensagem **do cliente** (`conversations.last_inbound_at`). Fora dela: `409 window_closed` e o front oferece template.
- **Fora da janela, só template aprovado** na Meta. O Inside Chat não aprova nada: o admin cadastra em *Administração → Templates* com `name` e `language` **idênticos** aos da Meta (`UNIQUE(name, language)`).
- Variáveis `{{1}}`, `{{2}}`... na ordem; todas obrigatórias e não vazias. O corpo salvo em `messages.body` é o texto renderizado (para o histórico), mas para a API vai só `name` + `language` + `parameters`.
- Categorias: `UTILITY`, `MARKETING`, `AUTHENTICATION`. Marketing exige **opt-in** do cliente (responsabilidade do negócio; não crie disparo em massa sem um cartão que trate opt-in e opt-out).
- Limite de 4096 caracteres por texto.
- Conversa `resolved` não envia (409 `resolved`); precisa reabrir.

## Regras internas

- **Nota interna** (`kind='note'`) nunca chama o `Channel`. Qualquer mudança em `sendMessage` precisa manter isso e ter teste.
- Falha da API **não** perde a mensagem: grava com `delivery_status='failed'` e `error`, e o front mostra "falhou". Não reenvie automaticamente (risco de duplicar para o cliente).
- Primeira resposta humana bem-sucedida grava `first_response_at`, assume a conversa se ninguém assumiu e muda `open → in_progress`. Isso alimenta os indicadores; não quebre.
- Token da Meta só em `config.whatsapp.accessToken` (env). Nunca em log, resposta da API ou front.

## Checklist de teste

- [ ] Texto dentro da janela envia; fora retorna 409 `window_closed`
- [ ] Template com parâmetro faltando → 400
- [ ] Nota não aparece em `MockChannel.sent`
- [ ] Falha do canal grava `failed` com erro
- [ ] Use `MockChannel` nos testes; nunca chame a Meta de verdade

Referência: https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates
