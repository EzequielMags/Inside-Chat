// Cordial — SPA sem build. Todo conteúdo dinâmico entra via textContent (sem innerHTML) para evitar XSS.

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
  if (res.status === 401 && !url.includes('/auth/login')) { state.me = null; render(); throw new Error('Sessão expirada'); }
  if (!res.ok) throw Object.assign(new Error(data.error || 'Erro'), { code: data.code });
  return data;
}

const STATUS = { open: 'Aberta', in_progress: 'Em andamento', resolved: 'Resolvida' };
const fmtTime = (iso) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const fmtDur = (s) => {
  if (s == null) return '—';
  if (s < 90) return `${s}s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${(s / 3600).toFixed(1)} h`;
  return `${(s / 86400).toFixed(1)} d`;
};
const fmtPhone = (p) => `+${p}`;
const opt = (value, label, sel) => h('option', { value, selected: sel }, label);

const state = {
  me: null, users: [], teams: [], templates: [],
  filters: { q: '', status: '', assignee: '', teamId: '', from: '', to: '', weekend: '' },
  list: [], current: null, tab: 'text', es: null,
};

const root = document.getElementById('app');

// ---------- roteamento ----------
const route = () => {
  const [, page = 'inbox', arg] = location.hash.split('/');
  return { page, arg };
};
window.addEventListener('hashchange', () => render());

async function boot() {
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
  root.replaceChildren();
  if (!state.me) { if (state.es) { state.es.close(); state.es = null; } return root.append(loginView()); }
  const { page } = route();
  const main = h('div', { class: 'main' });
  root.append(h('div', { class: 'shell' }, sidebar(page), main));
  const views = { inbox: inboxView, customers: customersView, metrics: metricsView, admin: adminView };
  (views[page] ?? inboxView)(main);
}

// ---------- login e layout ----------
function loginView() {
  const err = h('div', { class: 'err', role: 'alert' });
  const email = h('input', { type: 'email', placeholder: 'E-mail', autocomplete: 'username', required: true });
  const pass = h('input', { type: 'password', placeholder: 'Senha', autocomplete: 'current-password', required: true });
  return h('div', { class: 'login' }, h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        await api('POST', '/api/auth/login', { email: email.value, password: pass.value });
        await boot();
      } catch (x) { err.textContent = x.message; }
    },
  }, h('img', { src: '/logo.svg', alt: '' }), h('h1', {}, 'Cordial'),
  h('p', { class: 'muted' }, 'Entre para atender seus clientes.'), email, pass, err, h('button', { class: 'btn' }, 'Entrar')));
}

function sidebar(page) {
  const link = (p, label) => h('a', { href: `#/${p}`, class: page === p ? 'active' : '' }, label);
  return h('aside', { class: 'side' },
    h('div', { class: 'brand' }, h('img', { src: '/logo.svg', alt: '' }), 'Cordial'),
    h('nav', { class: 'nav' }, link('inbox', 'Caixa de entrada'), link('customers', 'Clientes'), link('metrics', 'Indicadores'),
      state.me.role === 'admin' ? link('admin', 'Administração') : null),
    h('div', { class: 'who' },
      h('div', {}, h('strong', {}, state.me.name), h('div', { class: 'muted' }, state.me.role === 'admin' ? 'Administrador' : 'Atendente')),
      h('button', { class: 'btn ghost small', onclick: async () => { await api('POST', '/api/auth/logout'); state.me = null; render(); } }, 'Sair')),
  );
}

// ---------- caixa de entrada ----------
function inboxView(main) {
  const { arg } = route();
  const wrap = h('div', { class: `inbox ${arg ? 'has-thread' : ''}` });
  main.append(wrap);
  const f = state.filters;
  const bind = (key, el) => { el.addEventListener('change', () => { f[key] = el.value; refreshList(); }); return el; };
  const search = h('input', { type: 'search', placeholder: 'Buscar nome, telefone ou texto', value: f.q, class: 'wide', 'aria-label': 'Buscar' });
  let t; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { f.q = search.value; refreshList(); }, 250); });
  const sel = (key, label, options) => h('label', {}, label, bind(key, h('select', {}, options.map(([v, l]) => opt(v, l, f[key] === String(v))))));
  const filters = h('div', { class: 'filters' }, search,
    sel('status', 'Status', [['', 'Todos'], ...Object.entries(STATUS)]),
    sel('assignee', 'Responsável', [['', 'Todos'], ['me', 'Eu'], ['none', 'Sem responsável'], ...state.users.filter((u) => u.active).map((u) => [u.id, u.name])]),
    sel('teamId', 'Equipe', [['', 'Todas'], ...state.teams.map((t) => [t.id, t.name])]),
    sel('weekend', 'Plantão', [['', 'Qualquer dia'], ['both', 'Sáb + Dom'], ['sat', 'Sábado'], ['sun', 'Domingo']]),
    h('label', {}, 'De', bind('from', h('input', { type: 'date', value: f.from }))),
    h('label', {}, 'Até', bind('to', h('input', { type: 'date', value: f.to }))),
  );
  const newBtn = h('button', { class: 'btn small ghost', onclick: startConversation }, 'Nova conversa');
  const simBtn = state.me.role === 'admin' && state.me.waMode === 'mock'
    ? h('button', { class: 'btn small ghost', onclick: simulate, title: 'Modo desenvolvimento' }, 'Simular cliente') : null;
  wrap.append(
    h('section', { class: 'list-col' }, filters, h('div', { class: 'filters' }, newBtn, simBtn), h('div', { class: 'items', id: 'items' })),
    h('section', { class: 'thread', id: 'thread' }, h('div', { class: 'empty' }, 'Selecione uma conversa.')),
  );
  refreshList();
  if (arg) openConversation(Number(arg));
}

async function refreshList() {
  const qs = new URLSearchParams(Object.entries(state.filters).filter(([, v]) => v));
  state.list = await api('GET', `/api/conversations?${qs}`);
  const box = document.getElementById('items');
  if (!box) return;
  const selected = Number(route().arg);
  box.replaceChildren(...(state.list.length ? state.list.map((c) => h('button', {
    class: `item ${c.id === selected ? 'sel' : ''}`, onclick: () => { location.hash = `#/inbox/${c.id}`; },
  },
  h('div', { class: 'row' }, h('span', { class: 'name' }, c.customer_name), c.unread_count ? h('span', { class: 'unread' }, c.unread_count) : null),
  h('div', { class: 'prev' }, c.last_preview || '—'),
  h('div', { class: 'row meta' }, h('span', { class: `badge ${c.status}` }, STATUS[c.status]), h('span', {}, c.assignee_name ?? 'Sem responsável'), h('span', {}, fmtTime(c.last_message_at)))))
    : [h('div', { class: 'empty' }, 'Nenhuma conversa com esses filtros.')]));
}

async function openConversation(id, keepComposer = false) {
  const thread = document.getElementById('thread');
  if (!thread) return;
  let data;
  try { data = await api('GET', `/api/conversations/${id}`); }
  catch (e) { thread.replaceChildren(h('div', { class: 'empty' }, e.message)); return; }
  state.current = data;
  if (data.conversation.unread_count) { api('POST', `/api/conversations/${id}/read`).then(refreshList); }
  const draft = keepComposer ? document.getElementById('draft')?.value : '';
  const { conversation: c, customer } = data;
  const patch = async (body) => { try { await api('PATCH', `/api/conversations/${id}`, body); } catch (e) { alert(e.message); } };

  const head = h('div', { class: 'thread-head' },
    h('div', {},
      h('button', { class: 'btn ghost small', onclick: () => { location.hash = '#/inbox'; } }, '←'), ' ',
      h('a', { href: `#/customers/${customer.id}` }, h('strong', {}, customer.name)),
      h('div', { class: 'muted' }, fmtPhone(customer.phone))),
    h('div', { class: 'ctl' },
      h('select', { 'aria-label': 'Status', onchange: (e) => patch({ status: e.target.value }) }, Object.entries(STATUS).map(([v, l]) => opt(v, l, c.status === v))),
      h('select', { 'aria-label': 'Responsável', onchange: (e) => patch({ assigneeId: e.target.value ? Number(e.target.value) : null }) },
        opt('', 'Sem responsável', !c.assignee_id), state.users.filter((u) => u.active).map((u) => opt(u.id, u.name, c.assignee_id === u.id))),
      h('select', { 'aria-label': 'Equipe', onchange: (e) => patch({ teamId: e.target.value ? Number(e.target.value) : null }) },
        opt('', 'Sem equipe', !c.team_id), state.teams.map((t) => opt(t.id, t.name, c.team_id === t.id)))),
  );

  const msgs = h('div', { class: 'msgs' }, data.messages.map((m) => {
    const cls = m.kind === 'note' ? 'note' : m.direction === 'out' ? 'out' : '';
    const who = m.kind === 'note' ? `Nota interna · ${m.sender_name}` : m.direction === 'out' ? (m.sender_name ?? '') : '';
    const st = m.delivery_status === 'failed' ? ` · falhou: ${m.error ?? ''}` : m.delivery_status === 'read' ? ' · lida' : m.delivery_status === 'delivered' ? ' · entregue' : '';
    return h('div', { class: `msg ${cls}` }, m.body,
      h('div', { class: 'info' }, [who, m.template_name ? `template ${m.template_name}` : '', fmtTime(m.created_at) + st].filter(Boolean).join(' · ')));
  }));

  const win = data.window;
  const banner = !win.open && c.status !== 'resolved'
    ? h('div', { class: 'banner' }, 'A janela de 24 h do WhatsApp está encerrada: só é possível enviar um template aprovado.') : null;
  if (!win.open && state.tab === 'text') state.tab = 'template';

  thread.replaceChildren(head, msgs, banner, c.status === 'resolved'
    ? h('div', { class: 'banner' }, 'Conversa resolvida. Reabra para responder (notas internas continuam disponíveis).') : null,
  composer(id, win, draft));
  msgs.scrollTop = msgs.scrollHeight;
}

function composer(id, win, draft = '') {
  const err = h('div', { class: 'err', role: 'alert' });
  const tabs = h('div', { class: 'tabs' });
  const body = h('div');
  const send = async (payload) => {
    err.textContent = '';
    try { await api('POST', `/api/conversations/${id}/messages`, payload); await openConversation(id); await refreshList(); }
    catch (e) { err.textContent = e.message; }
  };
  const textBox = (placeholder, kind) => {
    const ta = h('textarea', { id: 'draft', rows: 3, placeholder, maxlength: 4096 }); ta.value = draft;
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) go.click(); });
    const go = h('button', { class: 'btn', onclick: () => ta.value.trim() && send({ kind, body: ta.value }) }, kind === 'note' ? 'Salvar nota' : 'Enviar');
    return [ta, h('div', { class: 'actions' }, h('span', { class: 'muted' }, 'Ctrl+Enter envia'), go)];
  };
  const tplBox = () => {
    const tpls = state.templates.filter((t) => t.active);
    if (!tpls.length) return [h('div', { class: 'muted' }, 'Nenhum template cadastrado. Peça a um administrador.')];
    const sel = h('select', {}, tpls.map((t) => opt(t.id, `${t.name} (${t.language})`)));
    const preview = h('div', { class: 'msg out' });
    const fields = h('div', { class: 'form-row' });
    const upd = () => {
      const t = tpls.find((x) => x.id === Number(sel.value));
      const n = new Set([...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1])).size;
      fields.replaceChildren(...Array.from({ length: n }, (_, i) => {
        const inp = h('input', { placeholder: `{{${i + 1}}}`, 'aria-label': `Parâmetro ${i + 1}`, 'data-p': '1' });
        inp.addEventListener('input', paint); return inp;
      }));
      paint();
    };
    const params = () => [...fields.querySelectorAll('input')].map((i) => i.value);
    const paint = () => {
      const t = tpls.find((x) => x.id === Number(sel.value));
      const p = params(); preview.textContent = t.body.replace(/\{\{(\d+)\}\}/g, (_, n) => p[n - 1] || `{{${n}}}`);
    };
    sel.addEventListener('change', upd); upd();
    return [sel, fields, preview, h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => send({ kind: 'template', templateId: Number(sel.value), params: params() }) }, 'Enviar template'))];
  };
  const draw = () => {
    tabs.replaceChildren(...[['text', 'Responder'], ['template', 'Template'], ['note', 'Nota interna']].map(([k, l]) =>
      h('button', { class: state.tab === k ? 'on' : '', onclick: () => { state.tab = k; draw(); } }, l)));
    const content = state.tab === 'note' ? textBox('Nota visível só para a equipe (não é enviada ao cliente)', 'note')
      : state.tab === 'template' ? tplBox()
        : win.open ? textBox('Escreva sua resposta', 'text') : [h('div', { class: 'muted' }, 'Janela de 24 h encerrada. Use a aba Template.')];
    body.replaceChildren(...content);
  };
  draw();
  return h('div', { class: 'composer' }, tabs, body, err);
}

async function startConversation() {
  const phone = prompt('Telefone do cliente (DDI+DDD+número), ex.: 5511999990000');
  if (!phone) return;
  const name = prompt('Nome do cliente (opcional)') || undefined;
  try { const { id } = await api('POST', '/api/conversations', { phone, name }); state.tab = 'template'; location.hash = `#/inbox/${id}`; }
  catch (e) { alert(e.message); }
}

async function simulate() {
  const phone = prompt('Telefone do cliente simulado', '5511999990000');
  const text = phone && prompt('Mensagem do cliente', 'Olá, preciso de ajuda!');
  if (!text) return;
  try { await api('POST', '/api/dev/simulate-inbound', { phone, name: 'Cliente Simulado', text }); } catch (e) { alert(e.message); }
}

// ---------- clientes ----------
async function customersView(main) {
  const { arg } = route();
  if (arg) return customerDetail(main, Number(arg));
  const tbody = h('tbody');
  const search = h('input', { type: 'search', placeholder: 'Buscar por nome ou telefone', 'aria-label': 'Buscar clientes' });
  const load = async () => {
    const rows = await api('GET', `/api/customers?q=${encodeURIComponent(search.value)}`);
    tbody.replaceChildren(...rows.map((r) => h('tr', {},
      h('td', {}, h('a', { href: `#/customers/${r.id}` }, r.name)), h('td', {}, fmtPhone(r.phone)), h('td', {}, String(r.conversations)))));
  };
  let t; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); });
  main.append(h('div', { class: 'page' }, h('h2', {}, 'Clientes'), search, h('div', { class: 'form-row' }),
    h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Nome'), h('th', {}, 'Telefone'), h('th', {}, 'Conversas'))), tbody)));
  load();
}

async function customerDetail(main, id) {
  const { customer, conversations } = await api('GET', `/api/customers/${id}`);
  const name = h('input', { value: customer.name, 'aria-label': 'Nome' });
  const notes = h('textarea', { rows: 4, 'aria-label': 'Observações' }); notes.value = customer.notes;
  const msg = h('span', { class: 'muted' });
  main.append(h('div', { class: 'page' },
    h('a', { href: '#/customers' }, '← Clientes'), h('h2', {}, customer.name),
    h('p', { class: 'muted' }, `${fmtPhone(customer.phone)} · cliente desde ${fmtTime(customer.created_at)}`),
    h('div', { class: 'section' }, h('label', {}, 'Nome', name), h('div', {}, 'Observações sobre o cliente'), notes,
      h('div', { class: 'form-row' }, h('button', { class: 'btn', onclick: async () => {
        try { await api('PATCH', `/api/customers/${id}`, { name: name.value, notes: notes.value }); msg.textContent = 'Salvo.'; } catch (e) { msg.textContent = e.message; }
      } }, 'Salvar'), msg)),
    h('h3', {}, 'Histórico de conversas'),
    h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Início'), h('th', {}, 'Status'), h('th', {}, 'Responsável'), h('th', {}, 'Última mensagem'))),
      h('tbody', {}, conversations.map((c) => h('tr', {}, h('td', {}, h('a', { href: `#/inbox/${c.id}` }, fmtTime(c.created_at))),
        h('td', {}, STATUS[c.status]), h('td', {}, c.assignee_name ?? '—'), h('td', {}, c.last_preview)))))));
}

// ---------- indicadores ----------
async function metricsView(main) {
  const f = { from: '', to: '', weekend: '' };
  const out = h('div');
  const load = async () => {
    const m = await api('GET', `/api/metrics?${new URLSearchParams(Object.entries(f).filter(([, v]) => v))}`);
    const card = (label, v) => h('div', { class: 'card' }, h('div', { class: 'muted' }, label), h('div', { class: 'v' }, String(v)));
    const bars = (rows, k, v, max = Math.max(1, ...rows.map((r) => r[v]))) => h('div', { class: 'bars' }, rows.map((r) => h('div', { class: 'bar' },
      h('span', {}, r[k]), (() => { const i = h('i'); i.style.width = `${(r[v] / max) * 100}%`; return h('div', {}, i); })(), h('span', {}, String(r[v])))));
    out.replaceChildren(
      h('div', { class: 'cards' }, card('Conversas', m.total), card('Abertas', m.byStatus.open), card('Em andamento', m.byStatus.in_progress), card('Resolvidas', m.byStatus.resolved),
        card('1ª resposta (média)', fmtDur(m.firstResponse.avgSeconds)), card('1ª resposta (mediana)', fmtDur(m.firstResponse.medianSeconds)),
        card('Resolução (média)', fmtDur(m.resolution.avgSeconds))),
      h('div', { class: 'section' }, h('h3', {}, 'Conversas por dia'), m.perDay.length ? bars(m.perDay, 'day', 'count') : h('p', { class: 'muted' }, 'Sem dados no período.')),
      h('div', { class: 'section' }, h('h3', {}, 'Por responsável'), m.perAgent.length ? bars(m.perAgent, 'agent', 'count') : null));
  };
  const on = (k, el) => { el.addEventListener('change', () => { f[k] = el.value; load(); }); return el; };
  main.append(h('div', { class: 'page' }, h('h2', {}, 'Indicadores'),
    h('div', { class: 'form-row' },
      h('label', {}, 'De ', on('from', h('input', { type: 'date' }))), h('label', {}, 'Até ', on('to', h('input', { type: 'date' }))),
      h('label', {}, 'Plantão ', on('weekend', h('select', {}, opt('', 'Qualquer dia'), opt('both', 'Sáb + Dom'), opt('sat', 'Sábado'), opt('sun', 'Domingo'))))),
    out));
  load();
}

// ---------- administração ----------
async function adminView(main) {
  if (state.me.role !== 'admin') return main.append(h('div', { class: 'page' }, 'Acesso restrito.'));
  const page = h('div', { class: 'page' }, h('h2', {}, 'Administração'));
  main.append(page);
  const reload = async () => { await loadRefs(); page.replaceChildren(h('h2', {}, 'Administração'), ...(await sections())); };
  const wrap = (fn) => async (...a) => { try { await fn(...a); await reload(); } catch (e) { alert(e.message); } };

  async function sections() {
    const audit = await api('GET', '/api/audit');
    const input = (ph, type = 'text') => h('input', { placeholder: ph, type, 'aria-label': ph });

    // usuários
    const un = input('Nome'), ue = input('E-mail', 'email'), up = input('Senha (mín. 8)', 'password');
    const ur = h('select', {}, opt('agent', 'Atendente'), opt('admin', 'Administrador'));
    const ut = h('select', { multiple: true, 'aria-label': 'Equipes', size: Math.max(2, state.teams.length) }, state.teams.map((t) => opt(t.id, t.name)));
    const users = h('div', { class: 'section' }, h('h3', {}, 'Usuários'),
      h('div', { class: 'form-row' }, un, ue, up, ur, ut, h('button', { class: 'btn', onclick: wrap(() => api('POST', '/api/users', {
        name: un.value, email: ue.value, password: up.value, role: ur.value, teamIds: [...ut.selectedOptions].map((o) => Number(o.value)) })) }, 'Adicionar')),
      h('table', {}, h('thead', {}, h('tr', {}, ['Nome', 'E-mail', 'Perfil', 'Equipes', ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, state.users.map((u) => h('tr', {}, h('td', {}, u.name), h('td', {}, u.email), h('td', {}, u.role === 'admin' ? 'Admin' : 'Atendente'),
          h('td', {}, u.teamIds.map((id) => state.teams.find((t) => t.id === id)?.name).filter(Boolean).join(', ') || '—'),
          h('td', {}, h('button', { class: 'btn ghost small', onclick: wrap(() => api('PATCH', `/api/users/${u.id}`, { active: !u.active })) }, u.active ? 'Desativar' : 'Reativar'), ' ',
            h('button', { class: 'btn ghost small', onclick: wrap(async () => { const p = prompt('Nova senha (mín. 8)'); if (p) await api('PATCH', `/api/users/${u.id}`, { password: p }); }) }, 'Trocar senha'), ' ',
            h('button', { class: 'btn ghost small', onclick: wrap(async () => {
              const names = prompt(`Equipes de ${u.name} (ids separados por vírgula):\n${state.teams.map((t) => `${t.id} = ${t.name}`).join('\n')}`, u.teamIds.join(','));
              if (names !== null) await api('PATCH', `/api/users/${u.id}`, { teamIds: names.split(',').map((s) => Number(s.trim())).filter(Boolean) });
            }) }, 'Equipes')))))));

    // equipes
    const tn = input('Nome da equipe');
    const teams = h('div', { class: 'section' }, h('h3', {}, 'Equipes'),
      h('div', { class: 'form-row' }, tn, h('button', { class: 'btn', onclick: wrap(() => api('POST', '/api/teams', { name: tn.value })) }, 'Criar')),
      h('table', {}, h('tbody', {}, state.teams.map((t) => h('tr', {}, h('td', {}, t.name), h('td', { class: 'muted' }, `${t.memberIds.length} membro(s)`),
        h('td', {}, h('button', { class: 'btn ghost small', onclick: wrap(async () => { if (confirm(`Excluir a equipe ${t.name}?`)) await api('DELETE', `/api/teams/${t.id}`); }) }, 'Excluir')))))));

    // templates
    const pn = input('nome_do_template'), pl = input('Idioma'); pl.value = 'pt_BR';
    const pc = h('select', {}, opt('UTILITY', 'Utilidade'), opt('MARKETING', 'Marketing'), opt('AUTHENTICATION', 'Autenticação'));
    const pb = h('textarea', { rows: 2, placeholder: 'Texto com {{1}}, {{2}}... igual ao aprovado na Meta', 'aria-label': 'Texto' });
    const templates = h('div', { class: 'section' }, h('h3', {}, 'Templates do WhatsApp'),
      h('p', { class: 'muted' }, 'Cadastre aqui os templates já aprovados na Meta (nome e idioma idênticos). O envio fora da janela de 24 h só aceita estes.'),
      h('div', { class: 'form-row' }, pn, pl, pc, pb, h('button', { class: 'btn', onclick: wrap(() => api('POST', '/api/templates', { name: pn.value, language: pl.value, category: pc.value, body: pb.value })) }, 'Adicionar')),
      h('table', {}, h('tbody', {}, state.templates.map((t) => h('tr', {}, h('td', {}, `${t.name} (${t.language})`), h('td', {}, t.body),
        h('td', {}, h('button', { class: 'btn ghost small', onclick: wrap(() => api('PATCH', `/api/templates/${t.id}`, { active: !t.active })) }, t.active ? 'Desativar' : 'Ativar')))))));

    // auditoria
    const log = h('div', { class: 'section' }, h('h3', {}, 'Auditoria (últimos 200 eventos)'),
      h('table', {}, h('tbody', {}, audit.map((a) => h('tr', {}, h('td', {}, fmtTime(a.created_at)), h('td', {}, a.user_name ?? 'sistema'), h('td', {}, a.action), h('td', { class: 'muted' }, `${a.entity} #${a.entity_id ?? ''}`))))));
    return [users, teams, templates, log];
  }
  reload();
}

boot();
