# Deploy em produção (HTTPS)

Uma instância Node + SQLite atrás de um proxy reverso com TLS. Para mais de uma instância veja "Postgres" no `PLANO.md`.

## 1. Variáveis (`.env` no servidor, nunca no git)

```
NODE_ENV=production
PUBLIC_URL=https://atendimento.exemplo.com.br
TRUST_PROXY=1                 # 1 proxy (Caddy/nginx) na frente
WA_MODE=cloud
WA_VERIFY_TOKEN=<aleatório, 16+ caracteres>
WA_APP_SECRET= WA_ACCESS_TOKEN= WA_PHONE_NUMBER_ID=
SEED_ADMIN_PASSWORD=          # vazio = senha gerada e impressa no 1º start (anote e troque)
```

Gerar o token de verificação: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`.

Com `NODE_ENV=production` o app **recusa subir** se faltar `PUBLIC_URL` https, `WA_MODE=cloud` ou token de verificação forte
(`productionProblems` em `src/config.ts`). Isso também liga cookie `Secure` e HSTS.

## 2. Proxy e `TRUST_PROXY`

O app escuta só em `127.0.0.1` (`HOST`). O proxy termina o TLS e repassa `X-Forwarded-For`.
`TRUST_PROXY` = quantos proxies existem entre o cliente e o app. **Errado para menos**: o limitador de login enxerga o IP do
proxy (todos viram um só). **Errado para mais**: o cliente consegue forjar o IP. Para testar: erre a senha 5× e confira que
só o seu IP é bloqueado.

Caddy (HTTPS automático):

```
atendimento.exemplo.com.br {
  reverse_proxy 127.0.0.1:3000
}
```

nginx (o SSE precisa de buffer desligado):

```
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header Host $host;
  proxy_buffering off;          # /api/events (SSE)
  proxy_read_timeout 1h;
}
```

`GET /healthz` devolve `{"ok":true}` (sem autenticação, sem dados) para monitoramento/balanceador.

## 3. Backup

```
npm run backup     # copia consistente (VACUUM INTO, inclui o WAL) em BACKUP_DIR; mantém os BACKUP_KEEP mais recentes
```

Agende (cron ou Agendador de Tarefas) ao menos diário e **copie o resultado para fora da máquina**. Pasta de backup e disco do
banco em volume **criptografado** (BitLocker/LUKS): o arquivo contém telefones e conversas. Teste a restauração: aponte
`DB_PATH` para a cópia e confira as conversas. Não copie só `cordial.db` com o app rodando; use o comando acima.

## 4. Retenção (LGPD)

O prazo é decisão do jurídico (suposição em `PLANO.md`). Com `RETENTION_DAYS=N`:

```
npm run retention              # simulação: só conta
npm run retention -- --apply   # apaga conversas resolvidas há mais de N dias, suas mensagens e clientes que ficaram sem conversa
```

Faça backup antes de aplicar; o apagamento é irreversível. O `audit_log` registra só as contagens. Agende após o backup.
Backups antigos também contêm dados já apagados: `BACKUP_KEEP` deve caber no prazo de retenção.

## 5. Checklist

- [ ] `NODE_ENV=production`, app sobe sem erro de configuração
- [ ] HTTPS válido; `http://` redireciona; cookie `cordial_sid` com `Secure` e `HttpOnly`
- [ ] `TRUST_PROXY` conferido (limitador de login por IP)
- [ ] Senha do admin inicial trocada
- [ ] Backup agendado, cópia externa e restauração testada
- [ ] Disco/backup criptografados
- [ ] Prazo de retenção definido e agendado (ou registrado como pendente)
