// Inside Chat — SPA sem build. Todo conteúdo dinâmico entra via textContent (sem innerHTML) para evitar XSS.

// ---------- utilidades ----------
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'X-Requested-With': 'cordial', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  const isAuthCall = url.startsWith('/api/auth/') || url === '/api/me';
  if (res.status === 401 && !isAuthCall) { state.me = null; render(); throw new Error('Sua sessão expirou. Entre novamente.'); }
  if (!res.ok) throw Object.assign(new Error(data.error || 'Algo deu errado. Tente de novo.'), { code: data.code, status: res.status });
  return data;
}

const STATUS = { open: 'Aberta', in_progress: 'Em andamento', resolved: 'Resolvida' };
const USER_STATUS = { pending: 'Aguardando', approved: 'Ativo', rejected: 'Recusado' };
const fmtTime = (iso) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const fmtDay = (iso) => new Date(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
const fmtDur = (s) => {
  if (s == null) return '—';
  if (s < 90) return `${s}s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${(s / 3600).toFixed(1)} h`;
  return `${(s / 86400).toFixed(1)} d`;
};
const fmtPhone = (p) => `+${p}`;
const initials = (name) => (name.match(/\p{L}/gu) ? name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() : '#');
const opt = (value, label, sel) => h('option', { value, selected: sel }, label);
const empty = (title, hint) => h('div', { class: 'empty' }, h('strong', {}, title), hint ? h('span', {}, hint) : null);
const loading = (msg = 'Carregando…') => h('div', { class: 'loading', role: 'status' }, msg);

// Ícones e ilustração próprios, montados por DOM (sem innerHTML e sem dependência de UI).
const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid) el.append(kid);
  return el;
}
const ICONS = {
  search: [['circle', { cx: 11, cy: 11, r: 7 }], ['path', { d: 'M20 20l-3.5-3.5' }]],
  filter: [['path', { d: 'M3 5h18l-7 8v6l-4-2v-4z' }]],
  more: [['path', { d: 'M12 5h.01M12 12h.01M12 19h.01', 'stroke-width': 3 }]],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  chat: [['path', { d: 'M4 5h16v11H9l-5 4V5z' }]],
  users: [['circle', { cx: 9, cy: 8, r: 3.2 }], ['path', { d: 'M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6' }], ['circle', { cx: 17, cy: 9, r: 2.4 }], ['path', { d: 'M17 14.2c2.4 0 4 1.8 4 4.3' }]],
  chart: [['path', { d: 'M5 20V10M12 20V4M19 20v-7' }]],
  shield: [['path', { d: 'M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z' }]],
  logout: [['path', { d: 'M9 4H5v16h4M16 8l4 4-4 4M20 12H9' }]],
};
const icon = (name) => svg('svg', { viewBox: '0 0 24 24', class: 'ico', 'aria-hidden': 'true', focusable: 'false' }, ICONS[name].map(([tag, a]) => svg(tag, a)));

function chatIllustration() {
  return svg('svg', { viewBox: '0 0 220 180', class: 'ill', 'aria-hidden': 'true', focusable: 'false' },
    svg('rect', { x: 20, y: 20, width: 130, height: 84, rx: 16, class: 'ill-card' }),
    svg('path', { d: 'M44 104l-4 22 26-22z', class: 'ill-card' }),
    svg('rect', { x: 38, y: 38, width: 70, height: 8, rx: 4, class: 'ill-line' }),
    svg('rect', { x: 38, y: 56, width: 96, height: 8, rx: 4, class: 'ill-soft' }),
    svg('rect', { x: 38, y: 74, width: 54, height: 8, rx: 4, class: 'ill-soft' }),
    svg('rect', { x: 80, y: 84, width: 120, height: 72, rx: 16, class: 'ill-solid' }),
    svg('path', { d: 'M176 156l6 18-26-18z', class: 'ill-solid' }),
    svg('circle', { cx: 118, cy: 120, r: 7, class: 'ill-dot' }), svg('circle', { cx: 140, cy: 120, r: 7, class: 'ill-dot' }), svg('circle', { cx: 162, cy: 120, r: 7, class: 'ill-dot' }));
}
const emptyThread = () => h('div', { class: 'empty thread-empty' }, chatIllustration(),
  h('strong', {}, 'Selecione uma conversa para começar.'), h('span', {}, 'Escolha uma na lista ou toque em + para iniciar outra.'));

// Hoje mostra só a hora; antes disso, a data curta (lista de conversas).
const fmtShort = (iso) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

const state = {
  me: null, users: [], teams: [], templates: [],
  filters: { q: '', status: '', assignee: '', teamId: '', from: '', to: '', weekend: '' },
  list: [], current: null, tab: 'text', es: null, authMode: 'login',
};

const root = document.getElementById('app');

// ---------- diálogo (substitui alert/prompt/confirm) ----------
/**
 * fields: [{ name, label, type: text|email|password|textarea|select|checkboxes, value, options, help, required }]
 * onSubmit(values) pode lançar Error: a mensagem aparece no próprio diálogo.
 */
function askForm({ title, intro, fields = [], submit = 'Salvar', danger = false, onSubmit }) {
  const dlg = h('dialog', { 'aria-labelledby': 'dlg-title' });
  const getters = {};
  const err = h('div', { class: 'err', role: 'alert' });
  const build = (f) => {
    let input;
    if (f.type === 'textarea') { input = h('textarea', { rows: 3, required: f.required }); input.value = f.value ?? ''; getters[f.name] = () => input.value; }
    else if (f.type === 'select') { input = h('select', {}, f.options.map(([v, l]) => opt(v, l, String(v) === String(f.value)))); getters[f.name] = () => input.value; }
    else if (f.type === 'checkboxes') {
      const boxes = f.options.map(([v, l]) => ({ v, el: h('input', { type: 'checkbox', checked: (f.value ?? []).includes(v) }), l }));
      getters[f.name] = () => boxes.filter((b) => b.el.checked).map((b) => b.v);
      return h('fieldset', { class: 'field' }, h('legend', {}, f.label),
        boxes.length ? boxes.map((b) => h('label', {}, b.el, ` ${b.l}`)) : h('span', { class: 'help' }, 'Nenhuma equipe criada ainda.'));
    } else {
      input = h('input', { type: f.type ?? 'text', required: f.required, autocomplete: f.type === 'password' ? 'new-password' : 'off', minlength: f.minlength });
      input.value = f.value ?? ''; getters[f.name] = () => input.value;
    }
    return h('label', { class: 'field' }, f.label, input, f.help ? h('span', { class: 'help' }, f.help) : null);
  };
  const okBtn = h('button', { class: `btn ${danger ? 'danger' : ''}`, type: 'submit' }, submit);
  const form = h('form', {
    method: 'dialog',
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = ''; okBtn.disabled = true;
      try {
        await onSubmit(Object.fromEntries(Object.entries(getters).map(([k, g]) => [k, g()])));
        dlg.close();
      } catch (x) { err.textContent = x.message; okBtn.disabled = false; }
    },
  },
  h('h3', { id: 'dlg-title' }, title), intro ? h('p', { class: 'muted' }, intro) : null, fields.map(build), err,
  h('div', { class: 'actions' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => dlg.close() }, 'Cancelar'), okBtn));
  dlg.append(form);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  dlg.querySelector('input, textarea, select')?.focus();
}

const confirmAction = (title, intro, submit, onSubmit) => askForm({ title, intro, submit, danger: true, onSubmit });

// ---------- roteamento ----------
const route = () => {
  const [, page = 'inbox', arg] = location.hash.split('/');
  return { page, arg };
};
window.addEventListener('hashchange', () => render());

async function boot() {
  if (location.pathname === '/aprovar') return renderApproval();
  if (location.pathname === '/verificar') return renderVerify();
  try { state.me = await api('GET', '/api/me'); } catch { state.me = null; }
  if (state.me) await loadRefs();
  render();
}

async function loadRefs() {
  [state.users, state.teams, state.templates] = await Promise.all([
    api('GET', '/api/users'), api('GET', '/api/teams'), api('GET', '/api/templates'),
  ]);
  connectEvents();
}

function connectEvents() {
  if (state.es) return;
  let t;
  state.es = new EventSource('/api/events');
  state.es.onmessage = (ev) => {
    const e = JSON.parse(ev.data);
    clearTimeout(t);
    t = setTimeout(async () => {
      if (route().page === 'inbox') {
        await refreshList();
        if (state.current && state.current.conversation.id === e.conversationId) await openConversation(e.conversationId, true);
      }
    }, 150);
  };
  state.es.onerror = () => {}; // o navegador reconecta sozinho
}

function render() {
  if (location.pathname === '/aprovar' || location.pathname === '/verificar') return;
  root.replaceChildren();
  if (!state.me) {
    if (state.es) { state.es.close(); state.es = null; }
    return root.append(authView());
  }
  const { page } = route();
  const main = h('main', { class: 'main' });
  root.append(h('div', { class: 'shell' }, topbar(page), main));
  const views = { inbox: inboxView, customers: customersView, metrics: metricsView, admin: adminView };
  (views[page] ?? inboxView)(main);
}

// ---------- entrar / cadastrar ----------
function authShell(content) {
  return h('div', { class: 'auth' },
    h('section', { class: 'auth-panel', 'aria-hidden': 'true' },
      h('div', { class: 'brand' }, h('img', { src: '/logo.svg', alt: '' }), h('span', {}, 'Inside ', h('b', {}, 'Chat'))),
      h('h2', {}, 'Atendimento organizado, ', h('em', {}, 'equipe alinhada.')),
      h('ul', {}, h('li', {}, 'Uma caixa de entrada para todo o time'), h('li', {}, 'Histórico do cliente sempre à mão'), h('li', {}, 'Notas internas que o cliente nunca vê'))),
    h('main', { class: 'auth-main' }, h('div', { class: 'auth-card' },
      h('div', { class: 'brand brand-mobile' }, h('img', { src: '/logo.svg', alt: '' }), h('span', {}, 'Inside ', h('b', {}, 'Chat'))), content)));
}

function authView() {
  const mode = state.authMode;
  const switchTo = (m) => { state.authMode = m; render(); };
  if (mode === 'signup-done') {
    return authShell([
      h('div', { class: 'notice ok', role: 'status' }, h('strong', {}, 'Confirme seu e-mail'),
        'Enviamos um link para o e-mail que você informou. Ao abri-lo, você confirma que é você e escolhe sua senha. Depois o administrador analisa o pedido e você é avisado por e-mail quando o acesso for aprovado.'),
      h('p', { class: 'help' }, 'Não chegou? Veja a caixa de spam. Você pode repetir o cadastro após 5 minutos para receber outro link (até 3 vezes).'),
      h('p', { class: 'auth-switch' }, h('button', { onclick: () => switchTo('login') }, 'Voltar para o login')),
    ]);
  }
  const err = h('div', { class: 'err', role: 'alert' });
  const notice = h('div');
  const submit = h('button', { class: 'btn', type: 'submit' }, mode === 'login' ? 'Entrar' : 'Pedir acesso');
  const name = h('input', { type: 'text', autocomplete: 'name', required: true, minlength: 2, maxlength: 120 });
  const email = h('input', { type: 'email', autocomplete: 'username', required: true, maxlength: 200 });
  const pass = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const field = (label, input, help) => h('label', { class: 'field' }, label, input, help ? h('span', { class: 'help' }, help) : null);

  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = ''; notice.replaceChildren(); submit.disabled = true;
      try {
        if (mode === 'login') {
          await api('POST', '/api/auth/login', { email: email.value, password: pass.value });
          await boot();
        } else {
          await api('POST', '/api/auth/signup', { name: name.value, email: email.value });
          switchTo('signup-done');
        }
      } catch (x) {
        if (x.code === 'pending') notice.replaceChildren(h('div', { class: 'notice warn', role: 'alert' }, h('strong', {}, 'Aguardando aprovação'), x.message, ' Você será avisado por e-mail.'));
        else if (x.code === 'rejected') notice.replaceChildren(h('div', { class: 'notice bad', role: 'alert' }, x.message));
        else err.textContent = x.message;
        submit.disabled = false;
      }
    },
  },
  mode === 'signup' ? field('Nome', name) : null,
  field('E-mail', email), mode === 'login' ? field('Senha', pass) : null, notice, err, submit);

  return authShell([
    h('div', {}, h('h1', {}, mode === 'login' ? 'Entrar no Inside Chat' : 'Criar acesso'),
      h('p', { class: 'muted' }, mode === 'login' ? 'Use o e-mail e a senha da sua conta.' : 'Você confirma seu e-mail e escolhe a senha pelo link que enviaremos. O acesso só é liberado depois que o administrador aprovar.')),
    form,
    h('p', { class: 'auth-switch' }, mode === 'login' ? 'Ainda não tem acesso? ' : 'Já tem conta? ',
      h('button', { onclick: () => switchTo(mode === 'login' ? 'signup' : 'login') }, mode === 'login' ? 'Pedir acesso' : 'Entrar')),
  ]);
}

// Página aberta pelo link do e-mail do administrador (/aprovar?t=...).
async function renderApproval() {
  root.replaceChildren();
  const token = new URLSearchParams(location.search).get('t') ?? '';
  const body = h('div', {}, loading());
  root.append(authShell([h('h1', {}, 'Aprovar cadastro'), body]));
  const done = (cls, title, msg) => body.replaceChildren(
    h('div', { class: `notice ${cls}`, role: 'status' }, h('strong', {}, title), msg),
    h('p', { class: 'auth-switch' }, h('a', { href: '/' }, 'Ir para o Inside Chat')));
  let info;
  try { info = await api('GET', `/api/auth/approval?t=${encodeURIComponent(token)}`); }
  catch (e) {
    done('bad', 'Link indisponível', e.status === 410 ? 'Este link é inválido, expirou ou já foi usado. Se o cadastro ainda estiver pendente, peça um novo link: ele será enviado ao e-mail do aprovador.' : e.message);
    if (e.status !== 410) return;
    const msg = h('p', { class: 'help', role: 'status' });
    const btn = h('button', { class: 'btn ghost', onclick: async () => {
      btn.disabled = true;
      try { await api('POST', '/api/auth/approval/resend', { token }); msg.textContent = 'Pedido enviado. Se houver um cadastro pendente, o aprovador receberá um novo link por e-mail.'; }
      catch (err) { msg.textContent = err.message; btn.disabled = false; }
    } }, 'Pedir novo link');
    return body.firstChild.after(h('div', { class: 'row-actions' }, btn), msg);
  }

  const err = h('div', { class: 'err', role: 'alert' });
  const decide = (decision) => async (ev) => {
    ev.target.closest('.approve-card').querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      await api('POST', '/api/auth/approval', { token, decision });
      done(decision === 'approve' ? 'ok' : 'warn', decision === 'approve' ? 'Acesso aprovado' : 'Cadastro recusado',
        decision === 'approve' ? `${info.name} já pode entrar e foi avisado por e-mail.` : `${info.name} não terá acesso.`);
    } catch (e) { err.textContent = e.message; ev.target.closest('.approve-card').querySelectorAll('button').forEach((b) => { b.disabled = false; }); }
  };
  body.replaceChildren(h('div', { class: 'approve-card' },
    h('p', {}, 'Alguém pediu acesso ao Inside Chat como atendente e já confirmou que controla o e-mail abaixo. Confira os dados antes de decidir.'),
    h('dl', {}, h('dt', {}, 'Nome'), h('dd', {}, info.name), h('dt', {}, 'E-mail'), h('dd', {}, info.email), h('dt', {}, 'Pedido em'), h('dd', {}, fmtTime(info.requestedAt))),
    err,
    h('div', { class: 'row-actions' }, h('button', { class: 'btn', onclick: decide('approve') }, 'Aprovar acesso'), h('button', { class: 'btn ghost', onclick: decide('reject') }, 'Recusar')),
    h('p', { class: 'help' }, 'Se você não reconhece este pedido, recuse.')));
}

// Página aberta pelo link enviado ao solicitante (/verificar?t=...). A confirmação é um POST (um clique),
// para que leitores automáticos de e-mail que "abrem" links não confirmem sozinhos.
async function renderVerify() {
  root.replaceChildren();
  const token = new URLSearchParams(location.search).get('t') ?? '';
  const body = h('div', {}, loading());
  root.append(authShell([h('h1', {}, 'Confirmar e-mail'), body]));
  const home = h('p', { class: 'auth-switch' }, h('a', { href: '/' }, 'Ir para o Inside Chat'));
  let info;
  try { info = await api('GET', `/api/auth/verify?t=${encodeURIComponent(token)}`); }
  catch (e) {
    return body.replaceChildren(h('div', { class: 'notice bad', role: 'alert' }, h('strong', {}, 'Link indisponível'),
      e.status === 410 ? 'Este link é inválido, expirou ou já foi usado. Se ainda não confirmou, refaça o cadastro para receber outro.' : e.message), home);
  }
  const err = h('div', { class: 'err', role: 'alert' });
  const pass = h('input', { type: 'password', autocomplete: 'new-password' });
  const pass2 = h('input', { type: 'password', autocomplete: 'new-password' });
  const btn = h('button', { class: 'btn', onclick: async () => {
    err.textContent = '';
    if (!pass.value) { err.textContent = 'Informe a senha.'; return; }
    if (pass.value !== pass2.value) { err.textContent = 'As senhas não conferem.'; return; }
    btn.disabled = true;
    try {
      await api('POST', '/api/auth/verify', { token, password: pass.value });
      body.replaceChildren(h('div', { class: 'notice ok', role: 'status' }, h('strong', {}, 'E-mail confirmado'),
        'Avisamos o administrador. Você receberá um e-mail quando o acesso for aprovado.'), home);
    } catch (e) { err.textContent = e.message; btn.disabled = false; }
  } }, 'Confirmar e criar senha');
  const field = (label, input, help) => h('label', { class: 'field' }, label, input, help ? h('span', { class: 'help' }, help) : null);
  body.replaceChildren(h('div', { class: 'approve-card' }, h('p', {}, 'Confirme que o pedido de acesso ao Inside Chat foi feito por você e escolha sua senha.'),
    h('dl', {}, h('dt', {}, 'Nome'), h('dd', {}, info.name), h('dt', {}, 'E-mail'), h('dd', {}, info.email)),
    field('Senha', pass), field('Repita a senha', pass2), err, btn,
    h('p', { class: 'help' }, 'Se não foi você, feche esta página.')));
}

function topbar(page) {
  const link = (p, label, ico) => h('a', { href: `#/${p}`, class: page === p ? 'active' : '', 'aria-current': page === p ? 'page' : null }, icon(ico), h('span', {}, label));
  return h('header', { class: 'top' },
    h('div', { class: 'brand' }, h('img', { src: '/logo.svg', alt: '' }), h('span', {}, 'Inside ', h('b', {}, 'Chat'))),
    h('nav', { class: 'nav', 'aria-label': 'Principal' }, link('inbox', 'Conversas', 'chat'), link('customers', 'Clientes', 'users'), link('metrics', 'Indicadores', 'chart'),
      state.me.role === 'admin' ? link('admin', 'Administração', 'shield') : null),
    h('div', { class: 'who' },
      h('div', { class: 'who-text' }, h('div', { class: 'name' }, state.me.name), h('div', { class: 'muted' }, state.me.role === 'admin' ? 'Administrador' : 'Atendente')),
      h('div', { class: 'avatar small', 'aria-hidden': 'true' }, initials(state.me.name)),
      h('button', { class: 'icon-btn', 'aria-label': 'Sair', title: 'Sair', onclick: async () => { await api('POST', '/api/auth/logout'); state.me = null; state.authMode = 'login'; render(); } }, icon('logout'))),
  );
}

// ---------- caixa de entrada ----------
const CHIPS = [['', 'Todas'], ['open', 'Abertas'], ['in_progress', 'Em andamento'], ['resolved', 'Resolvidas']];
const ADV_KEYS = ['assignee', 'teamId', 'weekend', 'from', 'to'];

function inboxView(main) {
  const { arg } = route();
  const wrap = h('div', { class: `inbox ${arg ? 'has-thread' : ''}` });
  main.append(wrap);
  const f = state.filters;
  const bind = (key, el) => { el.addEventListener('change', () => { f[key] = el.value; refreshList(); syncFilterBtn(); }); return el; };
  const search = h('input', { type: 'search', placeholder: 'Pesquisar', value: f.q, 'aria-label': 'Buscar conversas por nome, telefone ou texto' });
  let t; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { f.q = search.value; refreshList(); }, 250); });
  const sel = (key, label, options) => h('label', {}, label, bind(key, h('select', {}, options.map(([v, l]) => opt(v, l, f[key] === String(v))))));
  const activeUsers = state.users.filter((u) => u.active);
  const advanced = h('div', { class: `filters ${ADV_KEYS.some((k) => f[k]) ? '' : 'hidden'}`, id: 'adv-filters' },
    sel('assignee', 'Responsável', [['', 'Todos'], ['me', 'Eu'], ['none', 'Sem responsável'], ...activeUsers.map((u) => [u.id, u.name])]),
    sel('teamId', 'Equipe', [['', 'Todas'], ...state.teams.map((x) => [x.id, x.name])]),
    sel('weekend', 'Plantão', [['', 'Qualquer dia'], ['both', 'Sáb + Dom'], ['sat', 'Sábado'], ['sun', 'Domingo']]),
    h('span'),
    h('label', {}, 'De', bind('from', h('input', { type: 'date', value: f.from }))),
    h('label', {}, 'Até', bind('to', h('input', { type: 'date', value: f.to }))));
  const filterBtn = h('button', { class: 'icon-btn', 'aria-label': 'Filtros', 'aria-controls': 'adv-filters', title: 'Filtros', onclick: () => {
    advanced.classList.toggle('hidden'); filterBtn.setAttribute('aria-expanded', String(!advanced.classList.contains('hidden')));
  } }, icon('filter'), h('i', { class: 'dot hidden' }));
  const syncFilterBtn = () => { filterBtn.querySelector('.dot').classList.toggle('hidden', !ADV_KEYS.some((k) => f[k])); };
  filterBtn.setAttribute('aria-expanded', String(!advanced.classList.contains('hidden'))); syncFilterBtn();

  // menu ⋮: limpar filtros e (só em dev) simular cliente
  const menu = h('div', { class: 'menu hidden', role: 'menu' },
    h('button', { role: 'menuitem', onclick: () => { Object.assign(f, { q: '', status: '', assignee: '', teamId: '', from: '', to: '', weekend: '' }); render(); } }, 'Limpar filtros'),
    state.me.role === 'admin' && state.me.waMode === 'mock'
      ? h('button', { role: 'menuitem', onclick: () => { menu.classList.add('hidden'); simulate(); }, title: 'Disponível só em modo de desenvolvimento' }, 'Simular cliente') : null);
  const moreBtn = h('button', { class: 'icon-btn', 'aria-label': 'Mais opções', 'aria-haspopup': 'menu', title: 'Mais opções', onclick: (ev) => { ev.stopPropagation(); menu.classList.toggle('hidden'); } }, icon('more'));
  const closeMenu = (ev) => { if (!menu.isConnected) return document.removeEventListener('click', closeMenu); if (!menu.contains(ev.target)) menu.classList.add('hidden'); };
  document.addEventListener('click', closeMenu);
  menu.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { menu.classList.add('hidden'); moreBtn.focus(); } });

  const searchRow = h('div', { class: 'searchrow' }, h('label', { class: 'search' }, icon('search'), search), filterBtn, h('div', { class: 'menu-wrap' }, moreBtn, menu));
  const chips = h('div', { class: 'chips', id: 'chips', role: 'group', 'aria-label': 'Filtrar por status' });
  const fab = h('button', { class: 'fab', 'aria-label': 'Nova conversa', title: 'Nova conversa', onclick: startConversation }, icon('plus'));
  wrap.append(
    h('section', { class: 'list-col', 'aria-label': 'Conversas' }, searchRow, chips, advanced, h('div', { class: 'items', id: 'items' }, loading()), fab),
    h('section', { class: 'thread', id: 'thread', 'aria-label': 'Conversa' }, emptyThread()),
  );
  refreshList();
  if (arg) openConversation(Number(arg));
}

function renderChips() {
  const box = document.getElementById('chips');
  if (!box) return;
  const all = state.listAll ?? [];
  const count = (st) => (st ? all.filter((c) => c.status === st).length : all.length);
  box.replaceChildren(...CHIPS.map(([v, label]) => h('button', {
    class: `chip ${state.filters.status === v ? 'on' : ''}`, 'aria-pressed': String(state.filters.status === v),
    onclick: () => { state.filters.status = v; refreshList(); },
  }, label, h('span', { class: 'count' }, count(v)))));
}

async function refreshList() {
  const box = document.getElementById('items');
  if (!box) return;
  // O status é filtrado aqui (não na API) para os contadores dos chips mostrarem todos os status.
  const qs = new URLSearchParams(Object.entries(state.filters).filter(([k, v]) => v && k !== 'status'));
  try { state.listAll = await api('GET', `/api/conversations?${qs}`); }
  catch (e) { box.replaceChildren(h('div', { class: 'err', role: 'alert' }, e.message)); return; }
  state.list = state.filters.status ? state.listAll.filter((c) => c.status === state.filters.status) : state.listAll;
  renderChips();
  const selected = Number(route().arg);
  box.replaceChildren(...(state.list.length ? state.list.map((c) => h('button', {
    class: `item s-${c.status} ${c.id === selected ? 'sel' : ''}`, 'aria-current': c.id === selected ? 'true' : null, onclick: () => { location.hash = `#/inbox/${c.id}`; },
  },
  h('div', { class: 'avatar', 'aria-hidden': 'true' }, initials(c.customer_name)),
  h('div', {},
    h('div', { class: 'row' }, h('span', { class: 'name' }, c.customer_name), h('time', { class: 'when', datetime: c.last_message_at, title: fmtTime(c.last_message_at) }, fmtShort(c.last_message_at))),
    h('div', { class: 'row' }, h('span', { class: 'prev' }, c.last_preview || '—'), c.unread_count ? h('span', { class: 'unread', 'aria-label': `${c.unread_count} não lidas` }, c.unread_count) : null),
    h('div', { class: 'row meta' }, h('span', { class: `badge ${c.status}` }, STATUS[c.status]), h('span', {}, c.assignee_name ?? 'Sem responsável')))))
    : [empty('Nenhuma conversa com esses filtros', 'Ajuste os filtros ou aguarde novas mensagens.')]));
}

async function openConversation(id, keepComposer = false) {
  const thread = document.getElementById('thread');
  if (!thread) return;
  if (!keepComposer) thread.replaceChildren(loading());
  let data;
  try { data = await api('GET', `/api/conversations/${id}`); }
  catch (e) { thread.replaceChildren(empty('Não foi possível abrir', e.message)); return; }
  state.current = data;
  if (data.conversation.unread_count) { api('POST', `/api/conversations/${id}/read`).then(refreshList).catch(() => {}); }
  const draft = keepComposer ? document.getElementById('draft')?.value : '';
  const { conversation: c, customer } = data;
  const ctlErr = h('div', { class: 'err', role: 'alert' });
  const patch = async (body) => { ctlErr.textContent = ''; try { await api('PATCH', `/api/conversations/${id}`, body); } catch (e) { ctlErr.textContent = e.message; } };
  const activeUsers = state.users.filter((u) => u.active);

  const head = h('div', { class: 'thread-head' },
    h('div', { class: 'who' },
      h('button', { class: 'btn ghost small back', 'aria-label': 'Voltar para a lista', onclick: () => { location.hash = '#/inbox'; } }, '←'),
      h('div', { class: 'avatar', 'aria-hidden': 'true' }, initials(customer.name)),
      h('div', {}, h('h3', {}, h('a', { href: `#/customers/${customer.id}` }, customer.name)), h('div', { class: 'muted' }, fmtPhone(customer.phone)))),
    h('div', { class: 'ctl' },
      h('select', { 'aria-label': 'Status', onchange: (e) => patch({ status: e.target.value }) }, Object.entries(STATUS).map(([v, l]) => opt(v, l, c.status === v))),
      h('select', { 'aria-label': 'Responsável', onchange: (e) => patch({ assigneeId: e.target.value ? Number(e.target.value) : null }) },
        opt('', 'Sem responsável', !c.assignee_id), activeUsers.map((u) => opt(u.id, u.name, c.assignee_id === u.id))),
      h('select', { 'aria-label': 'Equipe', onchange: (e) => patch({ teamId: e.target.value ? Number(e.target.value) : null }) },
        opt('', 'Sem equipe', !c.team_id), state.teams.map((x) => opt(x.id, x.name, c.team_id === x.id)))),
    ctlErr,
  );

  let lastDay = '';
  const items = [];
  for (const m of data.messages) {
    const day = new Date(m.created_at).toDateString();
    if (day !== lastDay) { lastDay = day; items.push(h('div', { class: 'day' }, fmtDay(m.created_at))); }
    const cls = m.kind === 'note' ? 'note' : m.direction === 'out' ? 'out' : '';
    const who = m.kind === 'note' ? `Nota interna · ${m.sender_name}` : m.direction === 'out' ? (m.sender_name ?? '') : '';
    const time = new Date(m.created_at).toLocaleTimeString('pt-BR', { timeStyle: 'short' });
    const st = m.delivery_status === 'failed' ? ` · não entregue${m.error ? `: ${m.error}` : ''}` : m.delivery_status === 'read' ? ' · lida' : m.delivery_status === 'delivered' ? ' · entregue' : '';
    items.push(h('div', { class: `msg ${cls}` }, m.body,
      h('div', { class: `info ${m.delivery_status === 'failed' ? 'failed' : ''}` }, [who, m.template_name ? `template ${m.template_name}` : '', time + st].filter(Boolean).join(' · '))));
  }
  const msgs = h('div', { class: 'msgs', tabindex: '0', 'aria-label': 'Mensagens' }, items);

  const win = data.window;
  const banner = !win.open && c.status !== 'resolved'
    ? h('div', { class: 'banner', role: 'status' }, 'A janela de 24 h do WhatsApp está encerrada: só é possível enviar um template aprovado.') : null;
  if (!win.open && state.tab === 'text') state.tab = 'template';

  thread.replaceChildren(...[head, msgs, banner, c.status === 'resolved'
    ? h('div', { class: 'banner', role: 'status' }, 'Conversa resolvida. Reabra para responder (notas internas continuam disponíveis).') : null,
  composer(id, win, draft)].filter(Boolean)); // replaceChildren transformaria null no texto "null"
  msgs.scrollTop = msgs.scrollHeight;
}

function composer(id, win, draft = '') {
  const err = h('div', { class: 'err', role: 'alert' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const body = h('div');
  const send = async (payload, btn) => {
    err.textContent = ''; if (btn) btn.disabled = true;
    try { await api('POST', `/api/conversations/${id}/messages`, payload); await openConversation(id); await refreshList(); }
    catch (e) { err.textContent = e.message; if (btn) btn.disabled = false; }
  };
  const textBox = (placeholder, kind) => {
    const ta = h('textarea', { id: 'draft', rows: 3, placeholder, maxlength: 4096, 'aria-label': kind === 'note' ? 'Nota interna' : 'Mensagem' }); ta.value = draft;
    const go = h('button', { class: 'btn', onclick: () => ta.value.trim() && send({ kind, body: ta.value }, go) }, kind === 'note' ? 'Salvar nota' : 'Enviar');
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) go.click(); });
    return [ta, h('div', { class: 'actions' }, h('span', { class: 'help' }, 'Ctrl+Enter envia'), go)];
  };
  const tplBox = () => {
    const tpls = state.templates.filter((t) => t.active);
    if (!tpls.length) return [empty('Nenhum template cadastrado', 'Peça a um administrador para cadastrar os templates aprovados na Meta.')];
    const sel = h('select', { 'aria-label': 'Template' }, tpls.map((t) => opt(t.id, `${t.name} (${t.language})`)));
    const preview = h('div', { class: 'msg out', 'aria-label': 'Pré-visualização' });
    const fields = h('div', { class: 'form-row' });
    const params = () => [...fields.querySelectorAll('input')].map((i) => i.value);
    const paint = () => {
      const t = tpls.find((x) => x.id === Number(sel.value));
      const p = params(); preview.textContent = t.body.replace(/\{\{(\d+)\}\}/g, (_, n) => p[n - 1] || `{{${n}}}`);
    };
    const upd = () => {
      const t = tpls.find((x) => x.id === Number(sel.value));
      const n = new Set([...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1])).size;
      fields.replaceChildren(...Array.from({ length: n }, (_, i) => {
        const inp = h('input', { placeholder: `Valor de {{${i + 1}}}`, 'aria-label': `Parâmetro ${i + 1}` });
        inp.addEventListener('input', paint); return inp;
      }));
      paint();
    };
    sel.addEventListener('change', upd); upd();
    const go = h('button', { class: 'btn', onclick: () => send({ kind: 'template', templateId: Number(sel.value), params: params() }, go) }, 'Enviar template');
    return [sel, fields, preview, h('div', { class: 'actions' }, go)];
  };
  const draw = () => {
    tabs.replaceChildren(...[['text', 'Responder'], ['template', 'Template'], ['note', 'Nota interna']].map(([k, l]) =>
      h('button', { class: state.tab === k ? 'on' : '', role: 'tab', 'aria-selected': state.tab === k ? 'true' : 'false', onclick: () => { state.tab = k; draw(); } }, l)));
    const content = state.tab === 'note' ? textBox('Nota visível só para a equipe (não é enviada ao cliente)', 'note')
      : state.tab === 'template' ? tplBox()
        : win.open ? textBox('Escreva sua resposta', 'text') : [h('div', { class: 'muted' }, 'Janela de 24 h encerrada. Use a aba Template.')];
    body.replaceChildren(...content);
  };
  draw();
  return h('div', { class: 'composer' }, tabs, body, err);
}

function startConversation() {
  askForm({
    title: 'Nova conversa', intro: 'Como o cliente ainda não escreveu, o primeiro contato deve ser um template aprovado.', submit: 'Criar',
    fields: [{ name: 'phone', label: 'Telefone', required: true, help: 'DDI + DDD + número, ex.: 5511999990000' }, { name: 'name', label: 'Nome (opcional)' }],
    onSubmit: async (v) => { const { id } = await api('POST', '/api/conversations', { phone: v.phone, name: v.name || undefined }); state.tab = 'template'; location.hash = `#/inbox/${id}`; },
  });
}

function simulate() {
  askForm({
    title: 'Simular mensagem de cliente', intro: 'Apenas para testes locais; nada passa pela Meta.', submit: 'Simular',
    fields: [{ name: 'phone', label: 'Telefone', value: '5511999990000', required: true }, { name: 'name', label: 'Nome', value: 'Cliente Simulado' },
      { name: 'text', label: 'Mensagem', type: 'textarea', value: 'Olá, preciso de ajuda!', required: true }],
    onSubmit: (v) => api('POST', '/api/dev/simulate-inbound', { phone: v.phone, name: v.name || undefined, text: v.text }),
  });
}

// ---------- clientes ----------
async function customersView(main) {
  const { arg } = route();
  if (arg) return customerDetail(main, Number(arg));
  const tbody = h('tbody');
  const holder = h('div', {}, loading());
  const search = h('input', { type: 'search', placeholder: 'Buscar por nome ou telefone', 'aria-label': 'Buscar clientes' });
  const load = async () => {
    try {
      const rows = await api('GET', `/api/customers?q=${encodeURIComponent(search.value)}`);
      tbody.replaceChildren(...rows.map((r) => h('tr', {},
        h('td', {}, h('a', { href: `#/customers/${r.id}` }, r.name)), h('td', {}, fmtPhone(r.phone)), h('td', {}, String(r.conversations)))));
      holder.replaceChildren(rows.length
        ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Nome'), h('th', {}, 'Telefone'), h('th', {}, 'Conversas'))), tbody))
        : empty('Nenhum cliente encontrado', 'Clientes aparecem aqui quando enviam a primeira mensagem.'));
    } catch (e) { holder.replaceChildren(h('div', { class: 'err', role: 'alert' }, e.message)); }
  };
  let t; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); });
  main.append(h('div', { class: 'page' }, h('h2', {}, 'Clientes'), search, h('div', { class: 'form-row' }), holder));
  load();
}

async function customerDetail(main, id) {
  const page = h('div', { class: 'page' }, loading());
  main.append(page);
  let data;
  try { data = await api('GET', `/api/customers/${id}`); }
  catch (e) { page.replaceChildren(h('a', { href: '#/customers' }, '← Clientes'), empty('Cliente não encontrado', e.message)); return; }
  const { customer, conversations } = data;
  const name = h('input', { value: customer.name, 'aria-label': 'Nome', maxlength: 120 });
  const notes = h('textarea', { rows: 4, 'aria-label': 'Observações', maxlength: 4000 }); notes.value = customer.notes;
  const msg = h('span', { role: 'status', class: 'muted' });
  page.replaceChildren(
    h('a', { href: '#/customers' }, '← Clientes'), h('h2', {}, customer.name),
    h('p', { class: 'muted' }, `${fmtPhone(customer.phone)} · cliente desde ${fmtTime(customer.created_at)}`),
    h('div', { class: 'section' },
      h('label', { class: 'field' }, 'Nome', name), h('label', { class: 'field' }, 'Observações sobre o cliente', notes),
      h('div', { class: 'form-row' }, h('button', { class: 'btn', onclick: async () => {
        msg.className = 'muted'; msg.textContent = 'Salvando…';
        try { await api('PATCH', `/api/customers/${id}`, { name: name.value, notes: notes.value }); msg.className = 'ok-msg'; msg.textContent = 'Salvo.'; }
        catch (e) { msg.className = 'err'; msg.textContent = e.message; }
      } }, 'Salvar'), msg)),
    h('h3', {}, 'Histórico de conversas'),
    conversations.length ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Início'), h('th', {}, 'Status'), h('th', {}, 'Responsável'), h('th', {}, 'Última mensagem'))),
      h('tbody', {}, conversations.map((c) => h('tr', {}, h('td', {}, h('a', { href: `#/inbox/${c.id}` }, fmtTime(c.created_at))),
        h('td', {}, h('span', { class: `badge ${c.status}` }, STATUS[c.status])), h('td', {}, c.assignee_name ?? '—'), h('td', {}, c.last_preview)))))) : empty('Sem conversas visíveis para você'));
}

// ---------- indicadores ----------
async function metricsView(main) {
  const f = { from: '', to: '', weekend: '' };
  const out = h('div', {}, loading());
  const load = async () => {
    let m;
    try { m = await api('GET', `/api/metrics?${new URLSearchParams(Object.entries(f).filter(([, v]) => v))}`); }
    catch (e) { out.replaceChildren(h('div', { class: 'err', role: 'alert' }, e.message)); return; }
    const card = (label, v) => h('div', { class: 'card' }, h('div', { class: 'muted' }, label), h('div', { class: 'v' }, String(v)));
    const bars = (rows, k, v) => { const max = Math.max(1, ...rows.map((r) => r[v])); return h('div', { class: 'bars' }, rows.map((r) => h('div', { class: 'bar' },
      h('span', {}, r[k]), (() => { const i = h('i'); i.style.width = `${(r[v] / max) * 100}%`; return h('div', {}, i); })(), h('span', {}, String(r[v]))))); };
    out.replaceChildren(
      h('div', { class: 'cards' }, card('Conversas', m.total), card('Abertas', m.byStatus.open), card('Em andamento', m.byStatus.in_progress), card('Resolvidas', m.byStatus.resolved),
        card('1ª resposta (média)', fmtDur(m.firstResponse.avgSeconds)), card('1ª resposta (mediana)', fmtDur(m.firstResponse.medianSeconds)),
        card('Resolução (média)', fmtDur(m.resolution.avgSeconds))),
      h('div', { class: 'section' }, h('h3', {}, 'Conversas por dia'), m.perDay.length ? bars(m.perDay, 'day', 'count') : empty('Sem dados no período')),
      h('div', { class: 'section' }, h('h3', {}, 'Por responsável'), m.perAgent.length ? bars(m.perAgent, 'agent', 'count') : empty('Sem dados no período')));
  };
  const on = (k, el) => { el.addEventListener('change', () => { f[k] = el.value; load(); }); return el; };
  main.append(h('div', { class: 'page' }, h('h2', {}, 'Indicadores'),
    h('div', { class: 'form-row' },
      h('label', { class: 'field' }, 'De', on('from', h('input', { type: 'date' }))), h('label', { class: 'field' }, 'Até', on('to', h('input', { type: 'date' }))),
      h('label', { class: 'field' }, 'Plantão', on('weekend', h('select', {}, opt('', 'Qualquer dia'), opt('both', 'Sáb + Dom'), opt('sat', 'Sábado'), opt('sun', 'Domingo'))))),
    out));
  load();
}

// ---------- administração ----------
async function adminView(main) {
  if (state.me.role !== 'admin') return main.append(h('div', { class: 'page' }, empty('Acesso restrito', 'Apenas administradores veem esta área.')));
  const page = h('div', { class: 'page' }, h('h2', {}, 'Administração'), loading());
  main.append(page);
  const reload = async () => {
    try { await loadRefs(); page.replaceChildren(h('h2', {}, 'Administração'), ...(await sections())); }
    catch (e) { page.replaceChildren(h('h2', {}, 'Administração'), h('div', { class: 'err', role: 'alert' }, e.message)); }
  };
  const after = (fn) => async (...a) => { await fn(...a); await reload(); };
  const tableWrap = (...kids) => h('div', { class: 'table-wrap' }, h('table', {}, ...kids));

  async function sections() {
    const audit = await api('GET', '/api/audit');
    const teamName = (id) => state.teams.find((t) => t.id === id)?.name;
    const teamOptions = state.teams.map((t) => [t.id, t.name]);
    const pending = state.users.filter((u) => u.status === 'pending');

    // cadastros pendentes (alternativa ao link do e-mail)
    const pend = pending.length ? h('div', { class: 'section' }, h('h3', {}, `Cadastros aguardando aprovação (${pending.length})`),
      h('p', { class: 'muted' }, 'Você também pode decidir pelo link enviado ao e-mail do administrador.'),
      tableWrap(h('tbody', {}, pending.map((u) => h('tr', {}, h('td', {}, u.name), h('td', {}, u.email),
        h('td', {}, u.email_verified ? h('span', { class: 'badge approved' }, 'E-mail confirmado') : h('span', { class: 'badge pending' }, 'E-mail não confirmado')),
        h('td', { class: 'actions' },
          h('button', { class: 'btn small', disabled: !u.email_verified, title: u.email_verified ? null : 'O solicitante precisa confirmar o e-mail primeiro', onclick: after(() => api('POST', `/api/users/${u.id}/approval`, { decision: 'approve' })) }, 'Aprovar'), ' ',
          h('button', { class: 'btn ghost small', onclick: () => confirmAction('Recusar cadastro', `${u.name} (${u.email}) não terá acesso.`, 'Recusar', after(() => api('POST', `/api/users/${u.id}/approval`, { decision: 'reject' }))) }, 'Recusar'))))))) : null;

    // usuários
    const newUser = () => askForm({
      title: 'Novo usuário', submit: 'Criar',
      fields: [{ name: 'name', label: 'Nome', required: true }, { name: 'email', label: 'E-mail', type: 'email', required: true },
        { name: 'password', label: 'Senha inicial', type: 'password', required: true },
        { name: 'role', label: 'Perfil', type: 'select', value: 'agent', options: [['agent', 'Atendente'], ['admin', 'Administrador']] },
        { name: 'teamIds', label: 'Equipes', type: 'checkboxes', options: teamOptions }],
      onSubmit: after((v) => api('POST', '/api/users', v)),
    });
    const resetPass = (u) => askForm({
      title: `Nova senha para ${u.name}`, intro: 'As sessões abertas dele serão encerradas.', submit: 'Trocar senha',
      fields: [{ name: 'password', label: 'Nova senha', type: 'password', required: true }],
      onSubmit: after((v) => api('PATCH', `/api/users/${u.id}`, { password: v.password })),
    });
    const editTeams = (u) => askForm({
      title: `Equipes de ${u.name}`, submit: 'Salvar',
      fields: [{ name: 'teamIds', label: 'Equipes', type: 'checkboxes', options: teamOptions, value: u.teamIds }],
      onSubmit: after((v) => api('PATCH', `/api/users/${u.id}`, { teamIds: v.teamIds })),
    });
    const approved = state.users.filter((u) => u.status !== 'pending');
    const users = h('div', { class: 'section' }, h('h3', {}, 'Usuários'),
      h('div', { class: 'form-row' }, h('button', { class: 'btn', onclick: newUser }, 'Novo usuário')),
      tableWrap(h('thead', {}, h('tr', {}, ['Nome', 'E-mail', 'Perfil', 'Situação', 'Equipes', ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, approved.map((u) => h('tr', {}, h('td', {}, u.name), h('td', {}, u.email), h('td', {}, u.role === 'admin' ? 'Admin' : 'Atendente'),
          h('td', {}, u.status === 'rejected' ? h('span', { class: 'badge rejected' }, USER_STATUS.rejected) : h('span', { class: `badge ${u.active ? 'approved' : 'off'}` }, u.active ? 'Ativo' : 'Inativo')),
          h('td', {}, u.teamIds.map(teamName).filter(Boolean).join(', ') || '—'),
          h('td', { class: 'actions' }, u.status === 'rejected' ? h('button', { class: 'btn ghost small', onclick: () => confirmAction('Reabrir cadastro',
            `${u.name} (${u.email}) volta para "aguardando aprovação"${u.email_verified ? ' e você poderá aprovar pelo painel' : ', mas precisará refazer o pedido para confirmar o e-mail'}.`,
            'Reabrir', after(() => api('POST', `/api/users/${u.id}/reopen`))) }, 'Reabrir') : [
            h('button', { class: 'btn ghost small', onclick: after(() => api('PATCH', `/api/users/${u.id}`, { active: !u.active })) }, u.active ? 'Desativar' : 'Reativar'), ' ',
            h('button', { class: 'btn ghost small', onclick: () => resetPass(u) }, 'Senha'), ' ',
            h('button', { class: 'btn ghost small', onclick: () => editTeams(u) }, 'Equipes')]))))));

    // equipes
    const newTeam = () => askForm({
      title: 'Nova equipe', submit: 'Criar', fields: [{ name: 'name', label: 'Nome da equipe', required: true }],
      onSubmit: after((v) => api('POST', '/api/teams', { name: v.name })),
    });
    const teams = h('div', { class: 'section' }, h('h3', {}, 'Equipes'),
      h('div', { class: 'form-row' }, h('button', { class: 'btn', onclick: newTeam }, 'Nova equipe')),
      state.teams.length ? tableWrap(h('tbody', {}, state.teams.map((t) => h('tr', {}, h('td', {}, t.name), h('td', { class: 'muted' }, `${t.memberIds.length} membro(s)`),
        h('td', { class: 'actions' }, h('button', { class: 'btn ghost small', onclick: () => confirmAction('Excluir equipe', `A equipe ${t.name} será removida e suas conversas ficarão sem equipe.`, 'Excluir', after(() => api('DELETE', `/api/teams/${t.id}`))) }, 'Excluir'))))))
        : empty('Nenhuma equipe', 'Crie equipes para organizar quem atende o quê.'));

    // templates
    const newTemplate = () => askForm({
      title: 'Novo template', intro: 'Nome e idioma precisam ser idênticos aos do template aprovado na Meta.', submit: 'Adicionar',
      fields: [{ name: 'name', label: 'Nome', required: true, help: 'minúsculas, números e _ (ex.: retorno_atendimento)' },
        { name: 'language', label: 'Idioma', value: 'pt_BR', required: true },
        { name: 'category', label: 'Categoria', type: 'select', value: 'UTILITY', options: [['UTILITY', 'Utilidade'], ['MARKETING', 'Marketing'], ['AUTHENTICATION', 'Autenticação']] },
        { name: 'body', label: 'Texto', type: 'textarea', required: true, help: 'Use {{1}}, {{2}}… como no template aprovado.' }],
      onSubmit: after((v) => api('POST', '/api/templates', v)),
    });
    const templates = h('div', { class: 'section' }, h('h3', {}, 'Templates do WhatsApp'),
      h('p', { class: 'muted' }, 'Fora da janela de 24 h só é possível enviar templates aprovados pela Meta.'),
      h('div', { class: 'form-row' }, h('button', { class: 'btn', onclick: newTemplate }, 'Novo template')),
      state.templates.length ? tableWrap(h('tbody', {}, state.templates.map((t) => h('tr', {}, h('td', {}, `${t.name} (${t.language})`), h('td', {}, t.body),
        h('td', { class: 'actions' }, h('button', { class: 'btn ghost small', onclick: after(() => api('PATCH', `/api/templates/${t.id}`, { active: !t.active })) }, t.active ? 'Desativar' : 'Ativar'))))))
        : empty('Nenhum template', 'Cadastre os templates aprovados na Meta.'));

    // auditoria
    const log = h('div', { class: 'section' }, h('h3', {}, 'Auditoria (últimos 200 eventos)'),
      audit.length ? tableWrap(h('tbody', {}, audit.map((a) => h('tr', {}, h('td', {}, fmtTime(a.created_at)), h('td', {}, a.user_name ?? 'sistema / e-mail'), h('td', {}, a.action), h('td', { class: 'muted' }, `${a.entity} #${a.entity_id ?? ''}`)))))
        : empty('Nada registrado ainda'));
    return [pend, users, teams, templates, log].filter(Boolean);
  }
  reload();
}

boot();
