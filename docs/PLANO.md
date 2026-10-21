# Cordial — plano do MVP

Caixa de entrada compartilhada para atendimento via WhatsApp Business Platform (Cloud API oficial da Meta).
O Integgri é usado apenas como referência conceitual do tipo de produto; nome, interface e textos aqui são próprios.

## 1. Escopo e decisões em aberto

| Decisão | Suposição adotada (registrada) | Impacto se mudar |
|---|---|---|
| Provedor WhatsApp | Cloud API oficial direta (sem BSP) | Trocar o adapter em `src/channels/` |
| Número | 1 número WhatsApp Business por instalação | Multi-número exige `channel_accounts` |
| Hospedagem | Uma instância Node + SQLite (arquivo) | Migrar para Postgres se >1 instância ou alto volume |
| Idioma / fuso | pt-BR, `America/Sao_Paulo` (offset fixo -03:00) | Variáveis `TIMEZONE` / `TZ_OFFSET` |
| "Plantão de fim de semana" | Conversa que recebeu mensagem do cliente num sábado e/ou domingo (fuso local). Filtro: Sáb, Dom ou Ambos | Escala formal de plantonistas fica fora do MVP |
| Permissões | Perfis `admin` e `agent`. Agente vê conversas atribuídas a ele, das suas equipes e as sem dono/sem equipe | Perfil supervisor depois |
| Nova mensagem após "resolvida" | Abre uma **nova** conversa (histórico continua no cliente) | — |
| Mídia (imagem/áudio/doc) | Fora do MVP: recebe placeholder `[imagem]` etc. | Etapa pós-MVP (download via media API) |
| Tempo real | SSE (Server-Sent Events) em vez de WebSocket | Suficiente para 1 via; simples e sem dependência |
| Cadastro de usuários | Autoatendimento com aprovação: conta nasce `pending`/inativa, sempre como `agent`; o aprovador (e-mail em `APPROVAL_EMAIL`, tipicamente o Gmail do admin) recebe link de uso único, 72 h, **só depois de o solicitante confirmar a posse do e-mail dele** (link próprio, onde ele também **define a senha**, evitando pré-sequestro de conta). Cadastro recusado bloqueia o e-mail até o admin **reabrir** pelo painel (volta a pendente, sem dar acesso; solicitante avisado por e-mail). Link de aprovação expirado pode ser reemitido pela página pública, mas o novo link vai sempre e só ao `APPROVAL_EMAIL` (teto de 5 e-mails de aprovação por cadastro; depois disso, só pelo painel). Posse do e-mail do admin = autorização. Painel de admin como alternativa | Dependência nova: `nodemailer`. Troca para OAuth/Gmail API se não quiser senha de app |
| Conformidade | LGPD: minimização, log de auditoria, política de retenção documentada | Definir prazo de retenção com o jurídico |

## 2. Arquitetura e stack

```
WhatsApp (Meta) ──webhook──▶  /webhooks/whatsapp ─┐
                                                   ▼
Navegador (SPA) ◀──SSE── API Fastify ── serviços de domínio ── SQLite
        └───── REST + cookie de sessão ───────────▲        (node:sqlite)
                                     Channel adapter (whatsapp-cloud | mock)
```

- **Node 24 + TypeScript** executado direto (type stripping), sem etapa de build. `tsc` só para checagem.
- **Fastify** (+ `@fastify/cookie`, `@fastify/static`) e **zod** para validação. Poucas dependências, de propósito.
- **SQLite via `node:sqlite`**: zero serviço externo para rodar local; o SQL é padrão e portável para Postgres.
- **Frontend**: SPA em JS puro (ES modules) sem build, construída com `textContent` (sem `innerHTML`) para evitar XSS.
- **Canais futuros**: interface `Channel` (`sendText`, `sendTemplate`) + parser de webhook por canal. Tabelas já têm
  coluna `channel`; adicionar e-mail/Instagram = novo adapter + rota de webhook, sem mexer na inbox.
- **Modo `mock`** (padrão): sem credenciais da Meta, o envio é simulado e há um botão "simular mensagem do cliente"
  para testar o fluxo completo localmente. `WA_MODE=cloud` ativa a integração real.

## 3. Fluxos principais

**Atendente**: login → inbox (filtros: status, responsável, equipe, período, plantão sáb/dom, busca) → abre conversa
→ assume/atribui → responde (texto dentro da janela de 24 h; **template** fora dela) → nota interna quando precisar
→ marca como "em andamento" / "resolvida" → consulta o cliente e seu histórico.

**Administrador**: cria usuários e equipes, define perfis → cadastra templates aprovados na Meta → acompanha indicadores
(volume, tempo de primeira resposta, tempo de resolução, por atendente) → consulta o log de auditoria.

## 4. Modelo de dados (resumo)

`users(status pending|approved|rejected)`, `signup_approvals(token_hash, expires_at, used_at)`, `teams`, `team_members`, `sessions` · `customers(phone único)` · `conversations(customer, channel, status,
assignee, team, created_at, last_inbound_at, first_response_at, resolved_at, unread_count)` ·
`messages(direction in/out, kind text|template|note, external_id único, delivery_status, local_dow)` ·
`templates(name, language, body, category)` · `audit_log`.
Notas internas são `messages` com `kind='note'` e **nunca** passam pelo adapter de canal.
`external_id` único dá idempotência aos webhooks (a Meta reentrega).

## 5. Etapas verificáveis

1. **Fundação**: projeto, config, banco, migrações, auth (scrypt + sessão), seed. *Verif.: login/logout via testes.*
2. **Núcleo da inbox**: ingestão de mensagens, conversas, envio, janela 24 h, templates, notas, SSE. *Verif.: testes de domínio.*
3. **Webhook WhatsApp**: verificação, assinatura HMAC, mensagens e status. *Verif.: testes com payload assinado.*
4. **Gestão**: clientes, usuários, equipes, permissões, auditoria.
5. **Filtros, plantão e indicadores**.
6. **Interface web** e identidade visual.
7. **Endurecimento**: rate limit de login, cabeçalhos de segurança, README e checklist de produção.

## 6. Riscos, dependências e limites do WhatsApp

- **Janela de 24 h**: só é possível enviar texto livre até 24 h após a última mensagem do cliente; depois, só
  **templates aprovados** pela Meta (revisão externa, pode ser recusado). O app bloqueia o texto livre fora da janela.
- **Dependências externas**: conta Meta Business verificada, número dedicado (não pode estar no app WhatsApp comum),
  token permanente (system user), URL pública HTTPS para o webhook, app secret para validar assinaturas.
- **Cobrança e limites**: a Meta cobra por conversa/mensagem de template e impõe limites de envio e qualidade do número.
- **Opt-in**: é preciso consentimento do cliente para mensagens iniciadas pela empresa. Responsabilidade do negócio.
- **Entrega**: webhooks podem chegar duplicados e fora de ordem (tratado por `external_id` e ranking de status).
- **Mídia, reações, mensagens interativas**: fora do MVP.
- **SQLite**: limite a uma instância; backup do arquivo + WAL. Plano de migração para Postgres.
- **Dados pessoais (LGPD)**: telefones e conteúdo de conversas; mitigar com HTTPS, cookies HttpOnly, hash de senha,
  auditoria, menor privilégio, criptografia de disco/backup e prazo de retenção definido.
