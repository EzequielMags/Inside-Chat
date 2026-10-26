---
name: frontend-design
description: Cria ou altera telas e componentes da interface do Inside Chat (SPA em JS puro em public/) seguindo a identidade visual própria - tokens de cor, tipografia, layout da inbox, estados de UI, acessibilidade, responsivo e modo escuro. Use ao criar tela nova, redesenhar uma existente, adicionar componente ou mexer em public/styles.css e public/app.js.
---

# Frontend Design

Arquivos: `public/index.html` (casca), `public/styles.css` (tokens e componentes), `public/app.js` (SPA com `h()`), `public/logo.svg`.

## Identidade do Inside Chat

Profissional, calmo e denso o bastante para trabalhar o dia todo. Nada de visual "de WhatsApp" (verde `#25D366`, balões iguais, ícones da Meta) nem do Integgri: a referência é só o tipo de produto.

- **Tema**: escuro, único (não há tema claro). Carvão quente (`--bg` #0d0c0b, `--surface` #161412, `--surface-2` #1f1c19), divisórias `--line` de 1px.
- **Cor da marca**: laranja `--brand` (#ff7a1a) com texto escuro `--brand-ink`; para texto/links laranja sobre fundo escuro use `--brand-text` (#ff9a4d). `--accent` âmbar claro só para o anel de foco.
- **Tipografia**: `system-ui`, 14px, line-height 1.45. Títulos de página `h2` (padrão do navegador, margem `0 0 14px`); rótulos de filtro 12px `--muted`; cabeçalho de tabela 12px maiúsculo com `letter-spacing: .04em`.
- **Raios**: 8px para controles, 10–14px para cartões, tabela e login, 999px para badges.
- **Espaçamento**: múltiplos de 2 entre 4 e 28px (gaps 4/6/8/12, padding de página 20px, seções com 28px).
- **Mensagens**: recebida `--in` à esquerda, enviada `--out` (marrom-alaranjado) à direita, **nota interna** `--note` (índigo, fora da família do laranja) centralizada com borda tracejada `--note-line`. A nota precisa ser inconfundível com uma mensagem ao cliente: não mude esse contraste.
- **Status**: `open` âmbar (`--warn-*`), `in_progress` laranja da marca, `resolved` `--ok`. Sempre com texto ("Aberta"), nunca só cor.

## Regras técnicas (inegociáveis)

1. **Sem `innerHTML`/`outerHTML`/`insertAdjacentHTML`.** Monte o DOM com `h(tag, props, ...filhos)`; texto entra como filho (vira `textContent`). A CSP (`script-src 'self'`, `style-src 'self'`) também proíbe `<script>`/`<style>` inline, `style=""` com conteúdo dinâmico e `onclick` em atributo: use `class` e `onclick` via `h()`.
2. **Sem build e sem dependência de UI** (nada de React, Tailwind, CDN, Google Fonts). Ícones: SVG próprio em `public/` ou caractere Unicode com `aria-label`.
3. **Cores só por token.** Nunca hex solto em regra nova; se faltar um token, crie em `:root` (tema escuro único).
4. **Chamadas à API** só por `api(method, url, body)`, que já manda o header CSRF e trata 401.
5. **Textos em pt-BR**, curtos, no tom do app ("Selecione uma conversa.", "Nenhuma conversa com esses filtros."). Para copy nova, siga a skill `design:ux-copy` se estiver disponível.

## Toda tela trata 4 estados

| Estado | Como |
|---|---|
| Carregando | texto `muted` ("Carregando…") ou botão `disabled` durante o envio; nunca tela branca |
| Vazio | `.empty` com uma frase do que fazer a seguir |
| Erro | `.err` com `role="alert"` perto da ação; `alert()` só como último recurso (há usos antigos a substituir) |
| Sucesso | atualização visível na própria tela; o SSE (`connectEvents`) já re-renderiza a inbox |

## Acessibilidade (WCAG 2.1 AA)

- Contraste ≥ 4.5:1 para texto e ≥ 3:1 para bordas de controle, **nos dois temas**. Confira ao criar token.
- Todo `input`/`select` sem `<label>` visível leva `aria-label`. Botão só com ícone leva `aria-label`.
- Foco visível: não remova o `:focus-visible` (contorno `--accent`). Tudo funciona por teclado; atalhos existentes (Ctrl+Enter envia) aparecem na tela.
- Use elementos semânticos (`button` para ação, `a` para navegação, `nav`, `section`, `table` com `th`).
- Alvo de toque ≥ 32px de altura em ações principais.

## Layout e responsivo

- Shell: sidebar de 210px + conteúdo. Inbox: lista de 340px + conversa. Páginas de gestão: `.page` com `max-width: 1000px`.
- Abaixo de 800px: a sidebar vira barra horizontal e a inbox mostra **ou** a lista **ou** a conversa (`.inbox.has-thread`). Toda tela nova precisa funcionar em 375px de largura sem rolagem horizontal da página.
- Texto longo (nome, telefone, preview) sempre com `text-overflow: ellipsis` ou `overflow-wrap: anywhere`.

## Componentes existentes (reuse antes de criar)

`.btn` (`.ghost`, `.small`), `.badge`, `.unread`, `.card`/`.cards`, `.bars`, `table`, `.form-row`, `.section`, `.filters`, `.tabs`, `.banner`, `.empty`, `.err`, `.muted`, `.msg` (`.out`, `.note`). Componente novo: classe curta no mesmo arquivo `styles.css`, agrupada sob o comentário da área (`/* inbox */`, `/* tabelas e cartões */`).

## Passo a passo

1. Leia a tela vizinha em `app.js` e copie o padrão (`<nome>View(main)`, rota por `location.hash`).
2. Esboce os 4 estados e o comportamento em 375px antes de codar.
3. Implemente reusando componentes; tokens novos nos dois temas.
4. Rode o app (`npm start`, modo mock, "Simular cliente") e confira no navegador, no tema escuro, desktop e 375px, navegando só pelo teclado.
5. Se mexeu em algo que mostra dado de cliente, confirme que o backend filtra por permissão (skill `permissao`): a UI esconder não é proteção.
6. Feche com a skill `pronto`.
