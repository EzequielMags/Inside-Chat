# Conectar o WhatsApp Cloud API real

Passos no painel da Meta (manuais; o Cordial não faz por você). Referência: https://developers.facebook.com/docs/whatsapp/cloud-api

1. **Conta**: Meta Business verificada e um app do tipo *Business* com o produto **WhatsApp**.
2. **Número**: dedicado e **fora** do app WhatsApp comum. Anote o **Phone number ID** (`WA_PHONE_NUMBER_ID`).
3. **Token permanente**: Business Settings → Usuários do sistema → gerar token com `whatsapp_business_messaging` e
   `whatsapp_business_management` (`WA_ACCESS_TOKEN`). O token temporário de 24 h do painel serve só para teste.
4. **App secret**: App → Configurações → Básico (`WA_APP_SECRET`); é a chave da assinatura `X-Hub-Signature-256`.
5. **`.env`**: `WA_MODE=cloud` + as 4 variáveis + `WA_VERIFY_TOKEN` (você inventa). Suba o app com HTTPS (`docs/DEPLOY.md`).
6. **Webhook**: WhatsApp → Configuração → URL `https://SEU-DOMINIO/webhooks/whatsapp` + o mesmo `WA_VERIFY_TOKEN`;
   **assine o campo `messages`** (traz mensagens recebidas e status de entrega).
7. **Templates**: crie e aguarde aprovação na Meta; depois cadastre em *Administração → Templates* com nome e idioma
   **idênticos** (ex.: `aviso_pedido` + `pt_BR`). Marketing exige opt-in do cliente.

## Teste ponta a ponta

- [ ] GET de verificação: a Meta mostra o webhook como verificado
- [ ] Do seu celular, mande mensagem ao número: aparece na inbox (SSE) e o cliente é criado
- [ ] Responda na inbox: chega no celular; o status passa a *entregue* e *lida*
- [ ] Reenvio do mesmo evento não duplica (idempotência por wamid)
- [ ] Após 24 h sem resposta do cliente: texto livre é bloqueado (409) e o template envia
- [ ] Template com parâmetros chega preenchido
- [ ] Em modo de teste da Meta só números cadastrados recebem (erro 131030 aparece como texto em pt-BR)

## Erros de envio

A inbox mostra um texto curto em pt-BR por código da Graph API (`describeGraphError` em `src/channels/whatsapp.ts`); a
resposta crua da Meta nunca é gravada nem exibida. Código novo? Acrescente em `GRAPH_ERRORS` com teste.
