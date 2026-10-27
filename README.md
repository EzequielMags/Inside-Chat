# Cordial

Caixa de entrada compartilhada para atendimento via WhatsApp Business Platform (Cloud API oficial).
Planejamento, decisões e riscos: [`docs/PLANO.md`](docs/PLANO.md).

## Rodar localmente

Requer **Node 24+** (usa `node:sqlite` e executa TypeScript direto, sem build).

```powershell
npm install
copy .env.example .env      # opcional; o padrão já funciona em modo mock
npm run seed:demo           # opcional: usuários, equipes, template e 3 conversas de exemplo
npm start                   # http://localhost:3000
```

- Sem `seed:demo`, o primeiro start cria o admin `admin@cordial.local` e **imprime a senha gerada** no console.
- Com `seed:demo` (só desenvolvimento): `admin@cordial.local`, `ana@cordial.local` (equipe Suporte) e
  `bruno@cordial.local` (Financeiro), todos com senha `demo12345`.
- **Modo mock** (`WA_MODE=mock`, padrão): nada é enviado à Meta. Como admin, use **Simular cliente** na caixa de
  entrada para criar mensagens recebidas e testar todo o fluxo.

```powershell
npm test            # testes (auth, permissões, janela 24h, plantão, webhook assinado, indicadores)
npm run typecheck   # tsc
```

## Conectar ao WhatsApp real

Passo a passo no painel da Meta e checklist de teste ponta a ponta: [`docs/WHATSAPP-REAL.md`](docs/WHATSAPP-REAL.md).
Resumo: `WA_MODE=cloud` + `WA_ACCESS_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_APP_SECRET`, `WA_VERIFY_TOKEN`; webhook HTTPS em
`/webhooks/whatsapp` assinando `messages`; templates aprovados cadastrados em *Administração → Templates*.

## Estrutura

```
src/app.ts          rotas HTTP, auth/CSRF, cabeçalhos de segurança, webhook, SSE
src/domain.ts       regras: ingestão, janela de 24h, envio, permissões, filtros, indicadores
src/channels/       interface Channel + WhatsApp Cloud + Mock (novos canais entram aqui)
src/db.ts           schema versionado (PRAGMA user_version) e auditoria
src/auth.ts         scrypt, sessões (hash no banco), limitador de login
public/             SPA sem build (JS puro, sem innerHTML)
test/               testes com node:test
```

## Suposições registradas

Veja a tabela em `docs/PLANO.md`. As principais: um número de WhatsApp; perfis admin/agente; agente vê o que é seu,
da sua equipe ou sem dono; nova mensagem após "resolvida" abre nova conversa; plantão = conversa com mensagem do cliente
recebida num sábado/domingo no fuso `America/Sao_Paulo`; mídia fora do MVP.

## Produção

Guia completo (proxy, `TRUST_PROXY`, backup, retenção LGPD, checklist): [`docs/DEPLOY.md`](docs/DEPLOY.md).

```powershell
npm run backup                   # cópia consistente do banco (agende)
npm run retention                # simulação da retenção (RETENTION_DAYS); "-- --apply" apaga
```

Com `NODE_ENV=production` o app recusa subir sem `PUBLIC_URL` https, `WA_MODE=cloud` e token de verificação forte.
O limitador de login é em memória (1 instância); para mais de uma: Postgres e SSE via pub/sub.
