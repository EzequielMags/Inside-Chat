# Inside Chat

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

## Cadastro com aprovação pelo Gmail do administrador

Qualquer pessoa pode pedir acesso em **Pedir acesso** na tela de login, mas a conta nasce **pendente** (perfil
atendente, sem login). O fluxo tem duas confirmações, cada uma por link de uso único (vale 72 h):

1. **O solicitante confirma o e-mail dele e escolhe a senha** (link enviado ao e-mail informado). O cadastro inicial
   pede só nome e e-mail: a senha nasce na página de confirmação, então quem digita o e-mail de outra pessoa nunca
   conhece a senha da conta. Sem a confirmação, o aprovador nem é avisado. Pedidos não confirmados expiram em 72 h,
   e cada cadastro recebe no máximo 3 e-mails de confirmação (1 a cada 5 min).
2. **O administrador aprova ou recusa** pelo link recebido no e-mail dele. O solicitante é avisado da decisão.

O painel *Administração → Cadastros aguardando aprovação* é a alternativa ao link (aprovar exige e-mail confirmado).
Um cadastro **recusado** pode ser reaberto pelo admin (botão *Reabrir* em *Usuários*): volta a "aguardando" sem dar acesso, e o solicitante é avisado por e-mail (sem link).
Se o link de aprovação expirar (72 h), a própria página oferece *Pedir novo link*: o link novo vai **só** para `APPROVAL_EMAIL` (no máximo 1 a cada 5 min e 5 por cadastro).

Para o e-mail chegar no Gmail do administrador, no `.env`:

```
APPROVAL_EMAIL=seu.gmail@gmail.com     # quem recebe os pedidos
PUBLIC_URL=https://seu-dominio          # o link do e-mail aponta para cá
SMTP_USER=seu.gmail@gmail.com           # conta que envia
SMTP_PASS=xxxx xxxx xxxx xxxx           # "senha de app" do Google (exige verificação em 2 etapas)
```

Sem `SMTP_*`, em desenvolvimento o e-mail (com o link) é impresso no console do servidor; em produção nada é
impresso (o link é uma credencial) e a aprovação fica pelo painel.

## Conectar ao WhatsApp real

1. Crie o app na Meta (WhatsApp Business Platform), um número dedicado e um token permanente (usuário do sistema).
2. No `.env`: `WA_MODE=cloud`, `WA_ACCESS_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_APP_SECRET`, `WA_VERIFY_TOKEN`.
3. Exponha o app em **HTTPS** público e configure o webhook da Meta em `https://SEU-DOMINIO/webhooks/whatsapp`
   com o mesmo `WA_VERIFY_TOKEN`; assine o campo `messages`.
4. Cadastre em *Administração → Templates* os templates **já aprovados** (nome/idioma idênticos aos da Meta).

## Estrutura

```
src/app.ts          rotas HTTP, auth/CSRF, cabeçalhos de segurança, webhook, SSE
src/domain.ts       regras: ingestão, janela de 24h, envio, permissões, filtros, indicadores
src/channels/       interface Channel + WhatsApp Cloud + Mock (novos canais entram aqui)
src/db.ts           schema versionado (PRAGMA user_version) e auditoria
src/auth.ts         scrypt, sessões (hash no banco), limitador de login
src/signup.ts       cadastro pendente, token de aprovação (hash no banco, uso único, expira)
src/mailer.ts       envio por SMTP (nodemailer) ou console em desenvolvimento
public/             SPA sem build (JS puro, sem innerHTML)
test/               testes com node:test
```

## Suposições registradas

Veja a tabela em `docs/PLANO.md`. As principais: um número de WhatsApp; perfis admin/agente; agente vê o que é seu,
da sua equipe ou sem dono; nova mensagem após "resolvida" abre nova conversa; plantão = conversa com mensagem do cliente
recebida num sábado/domingo no fuso `America/Sao_Paulo`; mídia fora do MVP.

## Antes de produção

- Rodar atrás de HTTPS (`NODE_ENV=production` ativa cookie `Secure` e HSTS) e proxy confiável.
- Backup do arquivo `data/*.db` (+ `-wal`), disco criptografado, definir prazo de retenção (LGPD).
- `TRUST_PROXY`: número exato de proxies reversos na frente do app (0 se não houver). Valor a mais deixa forjar o IP.
- Trocar a senha do admin inicial; o limitador de login é em memória (1 instância).
- Para mais de uma instância ou alto volume: migrar para Postgres e SSE via pub/sub.
