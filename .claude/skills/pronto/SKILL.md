---
name: pronto
description: Confere a Definition of Done do Cordial antes de dar uma tarefa como concluída ou abrir PR (testes, typecheck, segurança, LGPD, docs) e monta o resumo da entrega. Use quando o usuário disser "pronto", "terminei", "abre o PR" ou ao fim de uma etapa.
---

# Pronto?

Rode e mostre o resultado real (não resuma "passou" sem rodar):

```powershell
npm run typecheck
npm test
```

## Checklist

**Funcionamento**
- [ ] O pedido está atendido e dá para demonstrar no app (`npm start`, modo mock + "Simular cliente")
- [ ] Estados de carregando, vazio, erro e sucesso tratados no front

**Segurança e LGPD**
- [ ] Toda entrada nova validada com zod; SQL só com `?`
- [ ] Permissão checada no servidor (skill `permissao`); agente sem acesso recebe 404/403 em teste
- [ ] Sem `innerHTML` novo em `public/`
- [ ] Sem segredo, token, telefone ou corpo de mensagem em log, `audit_log.detail`, resposta de erro ou no repositório (`.env` fica fora do git)
- [ ] Webhook: assinatura validada e idempotência mantida (skill `whatsapp-webhook`)
- [ ] Nota interna continua sem passar pelo `Channel`

**Banco e config**
- [ ] Migration nova no **fim** de `MIGRATIONS`, testada em banco novo e existente (skill `nova-migration`)
- [ ] Variável nova em `config.ts` **e** `.env.example`

**Docs**
- [ ] `README.md` atualizado se mudou como rodar ou conectar
- [ ] Suposição nova registrada em `docs/PLANO.md`

## Resumo da entrega

```markdown
## O que muda
- ...

## Como testar
1. ...

## Suposições / pendências
- ...
```

Para revisão independente, rode o agent `revisor-seguranca-lgpd` no diff antes de entregar.
