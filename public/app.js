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

const STATUS = { open: 'Aguardando', in_progress: 'Em atendimento', resolved: 'Resolvida' };
const USER_STATUS = { pending: 'Aguardando', approved: 'Ativo', rejected: 'Recusado' };
const fmtTime = (iso) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
// "Hoje · segunda, 26 de outubro" (Ontem/Hoje na frente quando for o caso)
const fmtDay = (iso) => {
  const d = new Date(iso);
  const base = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }).replace('-feira', '');
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  return days === 0 ? `Hoje · ${base}` : days === 1 ? `Ontem · ${base}` : base;
};
const fmtStamp = (iso) => `${new Date(iso).toLocaleDateString('pt-BR')} ${new Date(iso).toLocaleTimeString('pt-BR', { timeStyle: 'short' })}`;
// "hoje, 11:12" / "amanhã, 11:12"; depois disso, data completa
const fmtWhen = (iso) => {
  const d = new Date(iso);
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
  const hm = d.toLocaleTimeString('pt-BR', { timeStyle: 'short' });
  return days === 0 ? `hoje, ${hm}` : days === 1 ? `amanhã, ${hm}` : fmtTime(iso);
};
const weekdayName = (iso) => { const w = new Date(iso).toLocaleDateString('pt-BR', { weekday: 'long' }); return w[0].toUpperCase() + w.slice(1); };
const fmtDur = (s) => {
  if (s == null) return '—';
  if (s < 90) return `${s}s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${(s / 3600).toFixed(1)} h`;
  return `${(s / 86400).toFixed(1)} d`;
};
// +55 11 98888-0003 (celular com 9 dígitos) ou +55 11 8888-0003; outros formatos ficam só com o +
const fmtPhone = (p) => {
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(p);
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : `+${p}`;
};
const initials = (name) => (name.match(/\p{L}/gu) ? name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() : '#');
const opt = (value, label, sel) => h('option', { value, selected: sel }, label);
const empty = (title, hint) => h('div', { class: 'empty' }, h('strong', {}, title), hint ? h('span', {}, hint) : null);
const loading = (msg = 'Carregando…') => h('div', { class: 'loading', role: 'status' }, msg);

// Cor de destaque: o laranja é o padrão; as outras trocam os tokens --brand* via [data-accent] (styles.css).
const ACCENTS = [['orange', 'Laranja'], ['blue', 'Azul'], ['green', 'Verde'], ['purple', 'Roxo'], ['pink', 'Rosa'], ['red', 'Vermelho'], ['gray', 'Cinza'], ['lightblue', 'Azul claro'], ['lightgreen', 'Verde claro'], ['black', 'Preto']];
function applyAccent(name, save = false) {
  const valid = ACCENTS.some(([k]) => k === name) ? name : 'orange';
  if (valid === 'orange') delete document.documentElement.dataset.accent; else document.documentElement.dataset.accent = valid;
  if (save) { try { localStorage.setItem('insidechat.accent', valid); } catch { /* sem armazenamento: vale só nesta sessão */ } }
  return valid;
}
const currentAccent = () => document.documentElement.dataset.accent ?? 'orange';
try { applyAccent(localStorage.getItem('insidechat.accent')); } catch { /* ignora */ }

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
  palette: [['path', { d: 'M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z' }], ['path', { d: 'M7.5 11h.01M10 7h.01M15 7h.01', 'stroke-width': 3 }]],
  back: [['path', { d: 'M15 5l-7 7 7 7' }]],
  right: [['path', { d: 'M9 5l7 7-7 7' }]],
  send: [['path', { d: 'M4 12l16-8-6 16-3-7z' }]],
  panel: [['path', { d: 'M4 5h16v14H4zM15 5v14' }]],
  clock: [['path', { d: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z' }]],
  play: [['path', { d: 'M8 5.5v13l11-6.5z', fill: 'currentColor' }]],
  download: [['path', { d: 'M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14' }]],
  alert: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 7.5v5.5M12 16.5h.01', 'stroke-width': 2.4 }]],
  lock: [['rect', { x: 5, y: 11, width: 14, height: 9, rx: 2 }], ['path', { d: 'M8 11V8a4 4 0 0 1 8 0v3' }]],
  user: [['circle', { cx: 12, cy: 8, r: 3.5 }], ['path', { d: 'M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7' }]],
  pin: [['path', { d: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z' }], ['circle', { cx: 12, cy: 10, r: 2.4 }]],
  bolt: [['path', { d: 'M13 3L5 14h6l-1 7 8-11h-6z' }]],
  checkc: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M8 12.5l2.7 2.7L16 9.5' }]],
  smile: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M8.5 14.5c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8M9 9.5h.01M15 9.5h.01', 'stroke-width': 2.4 }]],
  clip: [['path', { d: 'M20 11.5l-7.6 7.6a5 5 0 0 1-7-7l8-8a3.4 3.4 0 0 1 4.8 4.8l-8 8a1.7 1.7 0 0 1-2.4-2.4l7.2-7.2' }]],
  image: [['rect', { x: 3.5, y: 4.5, width: 17, height: 15, rx: 2 }], ['circle', { cx: 9, cy: 10, r: 1.6 }], ['path', { d: 'M4 17l5-4.5 4 3.5 3-2.5 4 3.5' }]],
  file: [['path', { d: 'M7 3.5h7l4 4V20.5H7zM14 3.5v4h4' }]],
  mic: [['rect', { x: 9, y: 3.5, width: 6, height: 11, rx: 3 }], ['path', { d: 'M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3' }]],
  close: [['path', { d: 'M6 6l12 12M18 6L6 18' }]],
  up: [['path', { d: 'M5 15l7-7 7 7' }]],
  down: [['path', { d: 'M5 9l7 7 7-7' }]],
  logout: [['path', { d: 'M9 4H5v16h4M16 8l4 4-4 4M20 12H9' }]],
};
const icon = (name) => svg('svg', { viewBox: '0 0 24 24', class: 'ico', 'aria-hidden': 'true', focusable: 'false' }, ICONS[name].map(([tag, a]) => svg(tag, a)));

const emptyThread = () => h('div', { class: 'empty thread-empty' }, h('img', { class: 'ill', src: '/ilustracao.svg', alt: '', width: 220, height: 180 }),
  h('strong', {}, 'Selecione uma conversa para começar.'), h('span', {}, 'Escolha uma na lista ou toque em + para iniciar outra.'));

// Corpo de mensagem de mídia (Figma "Mensagem de mídia"). Hoje o servidor ainda não guarda mídia:
// qualquer mensagem com `media: { type, ... }` já é desenhada; a página #/componentes mostra todos os estados.
const WAVE = [6, 10, 14, 8, 16, 12, 18, 10, 14, 20, 12, 8, 16, 10, 6, 12, 18, 14, 8, 12, 16, 10, 6, 8];
function mediaBody(md) {
  const cap = md.caption ? h('div', { class: 'media-cap' }, md.caption) : null;
  const preview = (inner, extra) => h('div', { class: 'media-box' }, md.src && String(md.src).startsWith('/api/') ? h('img', { src: md.src, alt: '' }) : inner, extra);
  switch (md.type) {
    case 'image': return [preview(icon('image')), cap];
    case 'video': return [preview(h('span', { class: 'play-circle' }, icon('play')), md.duration ? h('span', { class: 'dur-chip' }, md.duration) : null), cap];
    case 'audio': return [h('div', { class: 'audio-row' }, h('button', { type: 'button', class: 'play-btn', 'aria-label': 'Reproduzir áudio' }, icon('play')),
      h('div', { class: 'wave', 'aria-hidden': 'true' }, WAVE.map((n, i) => { const b = h('i', { class: i < 14 ? 'on' : '' }); b.style.height = `${n}px`; return b; })),
      h('span', { class: 'muted' }, md.duration ?? '')), cap];
    case 'document': return [h('div', { class: 'doc-row' }, h('span', { class: 'doc-ico' }, icon('file')),
      h('div', { class: 'doc-info' }, h('b', {}, md.name ?? 'documento'), h('span', { class: 'muted' }, md.meta ?? '')),
      h('button', { type: 'button', class: 'round-btn', 'aria-label': `Baixar ${md.name ?? 'documento'}`, title: 'Baixar' }, icon('download'))), cap];
    case 'sticker': return [h('div', { class: 'sticker-tile' }, icon('smile'))];
    case 'location': return [h('div', { class: 'media-box short' }, h('span', { class: 'pin-ico' }, icon('pin'))),
      h('div', { class: 'loc-title' }, md.address ?? ''), md.area ? h('div', { class: 'muted media-sub' }, md.area) : null];
    case 'contact': return [h('div', { class: 'contact-row' }, h('span', { class: 'contact-ico' }, icon('user')),
      h('div', { class: 'doc-info' }, h('b', {}, md.name ?? ''), h('span', { class: 'muted' }, md.phone ?? '')))];
    case 'loading': return [h('div', { class: 'media-box loading-box' }, icon('image'), h('span', { class: 'muted media-sub' }, 'Carregando imagem…'))];
    case 'error': return [h('div', { class: 'media-error', role: 'alert' }, h('div', { class: 'err-title' }, icon('alert'), 'Mídia indisponível'),
      h('p', {}, 'Não foi possível baixar o arquivo do WhatsApp.'), h('button', { type: 'button', class: 'link-btn' }, 'Tentar de novo'))];
    default: return [md.caption ?? ''];
  }
}

// Hoje mostra só a hora; antes disso, a data curta (lista de conversas).
const fmtShort = (iso) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

const state = {
  me: null, users: [], teams: [], templates: [], quickReplies: [], adminTab: 'users', search: null,
  filters: { q: '', status: 'in_progress', assignee: '', teamId: '', from: '', to: '', weekend: '' },
  list: [], current: null, tab: 'text', es: null, authMode: 'login',
};

const root = document.getElementById('app');
try { state.detailsOpen = localStorage.getItem('insidechat.details') !== '0'; } catch { state.detailsOpen = true; }

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
  [state.users, state.teams, state.templates, state.quickReplies] = await Promise.all([
    api('GET', '/api/users'), api('GET', '/api/teams'), api('GET', '/api/templates'), api('GET', '/api/quick-replies'),
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
  const views = { inbox: inboxView, customers: customersView, metrics: metricsView, admin: adminView, componentes: componentsView };
  (views[page] ?? inboxView)(main);
}

// ---------- entrar / cadastrar ----------
function authShell(content) {
  return h('div', { class: 'auth' },
    h('section', { class: 'auth-panel', 'aria-hidden': 'true' },
      h('div', { class: 'brand' }, h('img', { src: '/logo.png', alt: '' }), h('span', {}, 'Inside ', h('b', {}, 'Chat'))),
      h('h2', {}, 'Atendimento organizado, ', h('em', {}, 'equipe alinhada.')),
      h('ul', {}, h('li', {}, 'Uma caixa de entrada para todo o time'), h('li', {}, 'Histórico do cliente sempre à mão'), h('li', {}, 'Notas internas que o cliente nunca vê'))),
    h('main', { class: 'auth-main' }, h('div', { class: 'auth-card' },
      h('div', { class: 'brand brand-mobile' }, h('img', { src: '/logo.png', alt: '' }), h('span', {}, 'Inside ', h('b', {}, 'Chat'))), content)));
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

function accentMenu() {
  const swatches = ACCENTS.map(([k, label]) => h('button', { class: 'swatch', role: 'menuitemradio', 'aria-pressed': String(currentAccent() === k), onclick: () => {
    applyAccent(k, true);
    swatches.forEach((b, i) => b.setAttribute('aria-pressed', String(ACCENTS[i][0] === k)));
    menu.classList.add('hidden');
  } }, h('i', { class: `sw sw-${k}` }), label));
  const menu = h('div', { class: 'menu hidden', role: 'menu', 'aria-label': 'Cor do sistema' }, swatches);
  const btn = h('button', { class: 'icon-btn', 'aria-label': 'Cor do sistema', 'aria-haspopup': 'menu', title: 'Cor do sistema', onclick: (ev) => { ev.stopPropagation(); menu.classList.toggle('hidden'); } }, icon('palette'));
  const close = (ev) => { if (!menu.isConnected) return document.removeEventListener('click', close); if (!menu.contains(ev.target)) menu.classList.add('hidden'); };
  document.addEventListener('click', close);
  menu.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { menu.classList.add('hidden'); btn.focus(); } });
  return h('div', { class: 'menu-wrap accent-wrap' }, btn, menu);
}

function topbar(page) {
  const link = (p, label, ico) => h('a', { href: `#/${p}`, class: page === p ? 'active' : '', 'aria-current': page === p ? 'page' : null }, icon(ico), h('span', {}, label));
  return h('header', { class: 'top' },
    h('div', { class: 'brand' }, h('img', { src: '/logo.png', alt: '' }), h('span', {}, 'Inside ', h('b', {}, 'Chat'))),
    h('nav', { class: 'nav', 'aria-label': 'Principal' }, link('inbox', 'Conversas', 'chat'), link('customers', 'Clientes', 'users'), link('metrics', 'Indicadores', 'chart'),
      state.me.role === 'admin' ? link('admin', 'Administração', 'shield') : null),
    h('div', { class: 'who' }, accentMenu(),
      h('div', { class: 'who-text' }, h('div', { class: 'name' }, state.me.name), h('div', { class: 'muted' }, state.me.role === 'admin' ? 'Administrador' : 'Atendente')),
      h('div', { class: 'avatar small', 'aria-hidden': 'true' }, initials(state.me.name)),
      h('button', { class: 'icon-btn', 'aria-label': 'Sair', title: 'Sair', onclick: async () => { await api('POST', '/api/auth/logout'); state.me = null; state.authMode = 'login'; render(); } }, icon('logout'))),
  );
}

// ---------- caixa de entrada ----------
// Abas da lista = status da conversa (Atendimento, Aguardando, Resolvidas).
const CHIPS = [['in_progress', 'Atendimento'], ['open', 'Aguardando'], ['resolved', 'Resolvidas']];
const ADV_KEYS = ['assignee', 'teamId', 'weekend', 'from', 'to'];

// Botão com menu suspenso (⋮). Fecha ao clicar fora ou com Esc.
function popMenu(content, label, items) {
  const menu = h('div', { class: 'menu hidden', role: 'menu', 'aria-label': label },
    items.filter(Boolean).map(([text, fn, cls]) => h('button', { role: 'menuitem', class: cls, onclick: () => { menu.classList.add('hidden'); fn(); } }, text)));
  const btn = h('button', { class: 'icon-btn', 'aria-label': label, 'aria-haspopup': 'menu', title: label, onclick: (ev) => { ev.stopPropagation(); menu.classList.toggle('hidden'); } }, content);
  const close = (ev) => { if (!menu.isConnected) return document.removeEventListener('click', close); if (!menu.contains(ev.target)) menu.classList.add('hidden'); };
  document.addEventListener('click', close);
  menu.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { menu.classList.add('hidden'); btn.focus(); } });
  return h('div', { class: 'menu-wrap' }, btn, menu);
}

// Em telas estreitas o painel de detalhes vira uma gaveta (não lembra a escolha); em telas largas é uma coluna recolhível.
const narrow = () => matchMedia('(max-width: 1100px)').matches;
const detailsShown = () => (narrow() ? !!document.querySelector('.inbox.drawer') : state.detailsOpen);
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && document.querySelector('.inbox.drawer')) {
    document.querySelector('.inbox').classList.remove('drawer');
    document.querySelectorAll('.panel-toggle').forEach((b) => b.setAttribute('aria-pressed', 'false'));
  }
});

function toggleDetails(btn) {
  if (narrow()) {
    const on = document.querySelector('.inbox')?.classList.toggle('drawer');
    document.querySelectorAll('.panel-toggle').forEach((b) => b.setAttribute('aria-pressed', String(!!on)));
    if (!on) btn?.focus();
    return;
  }
  state.detailsOpen = !state.detailsOpen;
  try { localStorage.setItem('insidechat.details', state.detailsOpen ? '1' : '0'); } catch { /* vale só nesta sessão */ }
  document.querySelector('.inbox')?.classList.toggle('has-details', state.detailsOpen);
  document.querySelectorAll('.panel-toggle').forEach((b) => b.setAttribute('aria-pressed', String(state.detailsOpen)));
  if (!state.detailsOpen) btn?.focus();
}

function inboxView(main) {
  const { arg } = route();
  const wrap = h('div', { class: `inbox ${arg ? 'has-thread' : ''} ${arg && state.detailsOpen ? 'has-details' : ''}` });
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
  const more = popMenu(icon('more'), 'Mais opções', [
    ['Limpar filtros', () => { Object.assign(f, { q: '', status: 'in_progress', assignee: '', teamId: '', from: '', to: '', weekend: '' }); render(); }],
    state.me.role === 'admin' && state.me.waMode === 'mock' ? ['Simular cliente', simulate] : null,
  ]);

  const searchRow = h('div', { class: 'searchrow' }, h('label', { class: 'search' }, icon('search'), search), filterBtn, more);
  const chips = h('div', { class: 'chips', id: 'chips', role: 'group', 'aria-label': 'Filtrar por status' });
  const fab = h('button', { class: 'fab', 'aria-label': 'Nova conversa', title: 'Nova conversa', onclick: startConversation }, icon('plus'));
  wrap.append(
    h('section', { class: 'list-col', 'aria-label': 'Conversas' }, searchRow, chips, advanced, h('div', { class: 'items', id: 'items' }, loading()), fab),
    h('section', { class: 'thread', id: 'thread', 'aria-label': 'Conversa' }, emptyThread()),
    h('aside', { class: 'details', id: 'details', 'aria-label': 'Detalhes do cliente' }),
  );
  refreshList();
  if (arg) openConversation(Number(arg));
}

function renderChips() {
  const box = document.getElementById('chips');
  if (!box) return;
  const all = state.listAll ?? [];
  const count = (st) => all.filter((c) => c.status === st).length;
  box.replaceChildren(...CHIPS.map(([v, label]) => h('button', {
    class: `chip ${state.filters.status === v ? 'on' : ''}`, 'aria-pressed': String(state.filters.status === v),
    onclick: () => { state.filters.status = v; refreshList(); },
  }, label, h('span', { class: 'count' }, count(v)))));
}

// ACEITAR: o atendente assume a conversa que estava aguardando e ela passa para Atendimento.
async function acceptConversation(id) {
  try {
    await api('POST', `/api/conversations/${id}/accept`);
    state.filters.status = 'in_progress';
    const target = `#/inbox/${id}`;
    if (location.hash === target) { await openConversation(id); await refreshList(); } else location.hash = target;
  } catch (e) { await refreshList(); document.getElementById('items')?.prepend(h('div', { class: 'err list-err', role: 'alert' }, e.message)); }
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
  const open = (c) => { location.hash = `#/inbox/${c.id}`; };
  box.replaceChildren(...(state.list.length ? state.list.map((c) => h('div', {
    class: `item s-${c.status} ${c.id === selected ? 'sel' : ''}`, role: 'button', tabindex: '0', 'aria-current': c.id === selected ? 'true' : null,
    onclick: () => open(c), onkeydown: (ev) => { if (ev.target === ev.currentTarget && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); open(c); } },
  },
  h('div', { class: 'avatar', 'aria-hidden': 'true' }, initials(c.customer_name)),
  h('div', {},
    h('div', { class: 'row' }, h('span', { class: 'name' }, c.customer_name), h('time', { class: 'when', datetime: c.last_message_at, title: fmtTime(c.last_message_at) }, fmtShort(c.last_message_at))),
    h('div', { class: 'row' }, h('span', { class: 'prev' }, c.last_preview || '—'), c.unread_count ? h('span', { class: 'unread', 'aria-label': `${c.unread_count} não lidas` }, c.unread_count) : null),
    h('div', { class: 'row meta' }, h('span', { class: `badge ${c.status}` }, STATUS[c.status]),
      c.status === 'open' ? null : h('span', {}, c.assignee_name ?? 'Sem responsável'),
      c.status === 'open' ? h('button', { class: 'btn ghost small accept', onclick: (ev) => { ev.stopPropagation(); acceptConversation(c.id); } }, 'ACEITAR') : null))))
    : [empty(`Nenhuma conversa em ${CHIPS.find(([v]) => v === state.filters.status)?.[1] ?? 'conversas'}`, 'Ajuste os filtros ou aguarde novas mensagens.')]));
}

// Busca de texto dentro da conversa (a API respeita o acesso); o estado sobrevive às atualizações em tempo real.
function convSearchBar(id, msgs) {
  const s = state.search?.id === id ? state.search : (state.search = { id, q: '', ids: [], i: 0, open: false });
  const input = h('input', { type: 'search', placeholder: 'Buscar nesta conversa', 'aria-label': 'Buscar nesta conversa', maxlength: 100 });
  input.value = s.q;
  const count = h('span', { class: 'muted count', role: 'status' });
  const paint = (scroll) => {
    msgs.querySelectorAll('.hit').forEach((e) => e.classList.remove('hit', 'cur'));
    s.ids.forEach((mid, k) => {
      const el = msgs.querySelector(`[data-mid="${mid}"]`);
      if (!el) return;
      el.classList.add('hit');
      if (k === s.i) { el.classList.add('cur'); if (scroll) el.scrollIntoView({ block: 'center' }); }
    });
    count.textContent = !s.q ? '' : s.ids.length ? `${s.i + 1} de ${s.ids.length}` : 'Nada encontrado';
  };
  const run = async () => {
    s.q = input.value.trim();
    if (!s.q) { s.ids = []; s.i = 0; return paint(false); }
    try { s.ids = (await api('GET', `/api/conversations/${id}/search?q=${encodeURIComponent(s.q)}`)).ids; }
    catch (e) { s.ids = []; count.textContent = e.message; return; }
    s.i = s.ids.length - 1; // começa pela mais recente
    paint(true);
  };
  const step = (d) => { if (s.ids.length) { s.i = (s.i + d + s.ids.length) % s.ids.length; paint(true); } };
  let t; input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 250); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') close.click(); });
  const close = h('button', { class: 'icon-btn', 'aria-label': 'Fechar busca', title: 'Fechar busca', onclick: () => {
    Object.assign(s, { q: '', ids: [], i: 0, open: false }); input.value = ''; paint(false); bar.classList.add('hidden');
    document.getElementById('conv-search-btn')?.focus();
  } }, icon('close'));
  const bar = h('div', { class: `convsearch ${s.open ? '' : 'hidden'}` }, h('label', { class: 'search' }, icon('search'), input), count,
    h('button', { class: 'icon-btn', 'aria-label': 'Resultado anterior', title: 'Anterior', onclick: () => step(-1) }, icon('up')),
    h('button', { class: 'icon-btn', 'aria-label': 'Próximo resultado', title: 'Próximo', onclick: () => step(1) }, icon('down')), close);
  const toggle = () => { s.open = !s.open; bar.classList.toggle('hidden', !s.open); if (s.open) input.focus(); else close.click(); };
  return { bar, toggle, repaint: () => paint(false) };
}

const fmtLeft = (iso) => {
  const ms = Math.max(0, new Date(iso).getTime() - Date.now());
  return `${Math.floor(ms / 3_600_000)} h ${String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, '0')} min`;
};

function renderDetails(data, assignee) {
  const aside = document.getElementById('details');
  if (!aside) return;
  const { conversation: c, customer, window: win } = data;
  const team = state.teams.find((x) => x.id === c.team_id);
  const row = (k, v) => h('div', { class: 'kv' }, h('span', { class: 'muted' }, k), h('strong', {}, v));
  const section = (title, ...kids) => h('section', { class: 'dp-sec' }, h('h4', {}, title), ...kids);
  const pct = win.open ? Math.max(2, Math.min(100, ((new Date(win.expiresAt) - Date.now()) / (24 * 3_600_000)) * 100)) : 0;
  const bar = h('div', { class: 'bar-track' }); const fill = h('i', { class: win.open ? '' : 'closed' }); fill.style.width = `${pct}%`; bar.append(fill);
  const prev = h('div', { class: 'dp-prev' }, h('span', { class: 'muted' }, 'Carregando…'));
  aside.replaceChildren(
    h('div', { class: 'dp-head' }, h('h4', {}, 'Detalhes'),
      h('button', { class: 'icon-btn', 'aria-label': 'Fechar painel de detalhes', title: 'Fechar', onclick: (ev) => toggleDetails(ev.currentTarget) }, icon('right'))),
    h('div', { class: 'dp-profile' }, h('div', { class: 'avatar lg', 'aria-hidden': 'true' }, initials(customer.name)),
      h('a', { class: 'dp-name', href: `#/customers/${customer.id}` }, customer.name), h('span', { class: 'muted' }, fmtPhone(customer.phone))),
    section('Atendimento', row('Status', STATUS[c.status]), row('Responsável', assignee?.name ?? '—'), row('Equipe', team?.name ?? 'Sem equipe'), row('Plantão', weekdayName(c.last_inbound_at ?? c.created_at)), row('Cliente desde', new Date(customer.created_at).toLocaleDateString('pt-BR'))),
    section('Janela de 24 h', bar, h('p', { class: 'help' }, win.open
      ? `Texto livre liberado até ${fmtWhen(win.expiresAt)}. Depois, só template aprovado.`
      : 'Encerrada: só é possível enviar um template aprovado até o cliente escrever de novo.')),
    section('Notas do cliente', h('p', { class: 'dp-notes' }, customer.notes || 'Sem observações.'), h('a', { href: `#/customers/${customer.id}` }, 'Editar no cadastro')),
    section('Conversas anteriores', prev),
  );
  api('GET', `/api/customers/${customer.id}`).then(({ conversations }) => {
    const others = conversations.filter((x) => x.id !== c.id).slice(0, 5);
    prev.replaceChildren(...(others.length ? others.map((x) => h('a', { class: 'dp-conv', href: `#/inbox/${x.id}` },
      h('span', { class: 'dp-prevtext', title: `#${x.id} · ${fmtShort(x.last_message_at)}` }, (x.last_preview || `Atendimento #${x.id}`).replace(/^Você: /, '')), h('span', { class: `badge ${x.status}` }, STATUS[x.status])))
      : [h('span', { class: 'muted' }, 'Nenhuma.')]));
  }).catch(() => prev.replaceChildren(h('span', { class: 'muted' }, 'Não foi possível carregar.')));
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
  const ctlErr = h('div', { class: 'err head-err', role: 'alert' });
  const patch = async (body) => { ctlErr.textContent = ''; try { await api('PATCH', `/api/conversations/${id}`, body); } catch (e) { ctlErr.textContent = e.message; } };
  const activeUsers = state.users.filter((u) => u.active);
  const assignee = state.users.find((u) => u.id === c.assignee_id);
  const url = `/api/conversations/${id}`;
  const askAssign = () => askForm({
    title: 'Atribuir conversa', submit: 'Atribuir',
    fields: [{ name: 'assigneeId', label: 'Responsável', type: 'select', value: c.assignee_id ?? '', options: [['', 'Sem responsável'], ...activeUsers.map((u) => [u.id, u.name])] }],
    onSubmit: (v) => api('PATCH', url, { assigneeId: v.assigneeId ? Number(v.assigneeId) : null }),
  });
  const askTeam = () => askForm({
    title: 'Mudar equipe', submit: 'Salvar',
    fields: [{ name: 'teamId', label: 'Equipe', type: 'select', value: c.team_id ?? '', options: [['', 'Sem equipe'], ...state.teams.map((x) => [x.id, x.name])] }],
    onSubmit: (v) => api('PATCH', url, { teamId: v.teamId ? Number(v.teamId) : null }),
  });

  const msgs = h('div', { class: 'msgs', tabindex: '0', 'aria-label': 'Mensagens' });
  const search = convSearchBar(id, msgs);
  const win = data.window;
  const pill = h('span', { class: `win-pill ${win.open ? 'open' : 'closed'}` }, icon('clock'), win.open ? [h('span', { class: 'lbl' }, 'Janela aberta · '), fmtLeft(win.expiresAt)] : 'Janela fechada');
  const head = h('div', { class: 'thread-head' },
    h('button', { class: 'icon-btn back', 'aria-label': 'Voltar para a lista', title: 'Voltar', onclick: () => { location.hash = '#/inbox'; } }, icon('back')),
    h('div', { class: 'avatar', 'aria-hidden': 'true' }, initials(customer.name)),
    h('div', { class: 'who-info' },
      h('div', { class: 'row1' }, h('h3', {}, h('a', { href: `#/customers/${customer.id}` }, customer.name)), h('span', { class: 'ticket', title: 'Número do atendimento' }, `#${c.id}`)),
      h('div', { class: 'row2' }, h('span', { class: 'muted' }, h('span', { class: 'lbl' }, 'Atribuído a: '), assignee?.name ?? '—'),
        h('button', { class: 'icon-btn mini', 'aria-label': 'Atribuir conversa', title: 'Atribuir', onclick: askAssign }, icon('plus')), pill)),
    h('div', { class: 'head-actions' },
      c.status === 'resolved'
        ? h('button', { class: 'btn ghost small', onclick: () => patch({ status: 'in_progress' }) }, 'Reabrir')
        : h('button', { class: 'btn ghost small', onclick: () => patch({ status: 'resolved' }) }, 'Resolver'),
      h('button', { class: 'icon-btn', id: 'conv-search-btn', 'aria-label': 'Buscar na conversa', title: 'Buscar na conversa', onclick: () => search.toggle() }, icon('search')),
      h('button', { class: 'icon-btn panel-toggle', 'aria-label': 'Painel de detalhes', 'aria-pressed': String(detailsShown()), title: 'Painel de detalhes', onclick: (ev) => toggleDetails(ev.currentTarget) }, icon('panel')),
      popMenu(icon('more'), 'Mais opções da conversa', [
        c.status === 'resolved' ? ['Reabrir', () => patch({ status: 'in_progress' }), 'only-narrow'] : ['Resolver', () => patch({ status: 'resolved' }), 'only-narrow'],
        ['Atribuir…', askAssign], ['Mudar equipe…', askTeam],
        c.status === 'open' ? null : ['Devolver para Aguardando', () => patch({ status: 'open', assigneeId: null })],
      ])),
  );

  let lastDay = '';
  const items = [];
  const TICKS = { sent: ['✓', 'Enviada'], delivered: ['✓✓', 'Entregue'], read: ['✓✓', 'Lida'] };
  for (const m of data.messages) {
    const day = new Date(m.created_at).toDateString();
    if (day !== lastDay) { lastDay = day; items.push(h('div', { class: 'day' }, fmtDay(m.created_at))); }
    const time = new Date(m.created_at).toLocaleTimeString('pt-BR', { timeStyle: 'short' });
    if (m.kind === 'event') { items.push(h('div', { class: 'sys-event', 'data-mid': m.id }, `${m.body} · ${fmtStamp(m.created_at)} · #${c.id}`)); continue; }
    const failed = m.delivery_status === 'failed';
    const tick = m.direction === 'out' && m.kind !== 'note' && TICKS[m.delivery_status];
    let bubble;
    if (m.kind === 'note') {
      bubble = h('div', { class: 'msg note', 'data-mid': m.id },
        h('div', { class: 'note-head' }, icon('lock'), 'Nota interna · só a equipe vê'), m.body,
        h('div', { class: 'info' }, `${m.sender_name ?? ''} · ${time} · visível só para a equipe`));
    } else {
      const parts = [m.direction === 'out' ? (m.sender_name ?? '') : '', m.template_name ? `template ${m.template_name}` : '', time + (failed ? ` · não entregue${m.error ? `: ${m.error}` : ''}` : '')].filter(Boolean);
      bubble = h('div', { class: `msg ${m.direction === 'out' ? 'out' : ''} ${m.media ? `media ${m.media.type}` : ''}`, 'data-mid': m.id }, m.media ? mediaBody(m.media) : m.body,
        h('div', { class: `info ${failed ? 'failed' : ''}` }, parts.join(' · '),
          tick ? h('span', { class: `ticks ${m.delivery_status}`, title: tick[1] }, ` · ${tick[0]} ${tick[1].toLowerCase()}`) : null));
    }
    // mensagem recebida: avatar do cliente ao lado
    items.push(m.direction === 'in' && m.kind !== 'note'
      ? h('div', { class: 'mrow' }, h('div', { class: 'avatar xs', 'aria-hidden': 'true' }, initials(customer.name)), bubble) : bubble);
  }
  msgs.replaceChildren(...items);

  const banner = !win.open && c.status !== 'resolved'
    ? h('div', { class: 'banner', role: 'status' }, h('strong', {}, 'Fora da janela de 24 h. '), 'O WhatsApp só permite escrever primeiro com um template (modelo aprovado pela Meta). Escolha um na aba Template; quando o cliente responder, a conversa livre volta.') : null;
  if (!win.open && state.tab === 'text') state.tab = 'template';

  thread.replaceChildren(...[head, search.bar, ctlErr, msgs, banner, c.status === 'resolved'
    ? h('div', { class: 'banner', role: 'status' }, 'Conversa resolvida. Reabra para responder (notas internas continuam disponíveis).') : null,
  composer(id, win, draft)].filter(Boolean)); // replaceChildren transformaria null no texto "null"
  msgs.scrollTop = msgs.scrollHeight;
  search.repaint();
  renderDetails(data, assignee);
}

const EMOJIS = ['😀', '😊', '😉', '😍', '🙏', '👍', '👏', '🎉', '❤️', '😂', '🤝', '✅', '⚠️', '📞', '⏰', '🙂', '😅', '🤔', '😢', '👋', '🔥', '⭐', '💬', '📌'];

function composer(id, win, draft = '') {
  const err = h('div', { class: 'err', role: 'alert' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const body = h('div', { class: 'composer-body' });
  const send = async (payload, btn) => {
    err.textContent = ''; if (btn) btn.disabled = true;
    try { await api('POST', `/api/conversations/${id}/messages`, payload); await openConversation(id); await refreshList(); }
    catch (e) { err.textContent = e.message; if (btn) btn.disabled = false; }
  };
  const textBox = (placeholder, kind) => {
    const isNote = kind === 'note';
    const ta = h('textarea', { id: 'draft', rows: 1, placeholder, maxlength: 4096, 'aria-label': isNote ? 'Nota interna' : 'Mensagem' }); ta.value = draft;
    const label = isNote ? 'Salvar nota' : 'Enviar mensagem';
    // anexos: escolha e pré-visualização no navegador; o envio depende do backend de mídia (ainda não existe)
    const att = state.attach?.id === id ? state.attach : (state.attach = { id, items: [] });
    const tray = h('div', { class: 'attach-tray hidden' });
    const fmtSize = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`);
    const paintTray = () => {
      tray.classList.toggle('hidden', !att.items.length);
      tray.replaceChildren(...att.items.map((a, i) => h('div', { class: 'att' },
        a.thumb ? h('img', { src: a.thumb, alt: '' }) : h('span', { class: 'att-ico' }, icon(a.icon)),
        h('div', { class: 'att-info' }, h('b', {}, a.name), h('span', { class: 'muted' }, a.meta)),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remover ${a.name}`, title: 'Remover', onclick: () => { att.items.splice(i, 1); paintTray(); } }, icon('close')))),
      h('span', { class: 'help' }, 'Envio de mídia ainda não está disponível neste servidor: o anexo fica só na pré-visualização.'));
    };
    const pick = (accept, ic, label) => {
      const input = h('input', { type: 'file', accept });
      input.addEventListener('change', () => {
        const f = input.files?.[0];
        if (!f) return;
        if (f.size > 16 * 1048576) { err.textContent = 'Arquivo grande demais (máx. 16 MB).'; return; }
        err.textContent = '';
        const item = { name: f.name, meta: `${label} · ${fmtSize(f.size)}`, icon: ic };
        const add = () => { att.items.push(item); paintTray(); };
        if (f.type.startsWith('image/') && f.size <= 5 * 1048576) { const r = new FileReader(); r.onload = () => { item.thumb = r.result; add(); }; r.onerror = add; r.readAsDataURL(f); } else add();
      });
      input.click();
    };
    const askContact = () => askForm({ title: 'Enviar contato', submit: 'Anexar',
      fields: [{ name: 'name', label: 'Nome', required: true }, { name: 'phone', label: 'Telefone', required: true, help: 'DDI + DDD + número' }],
      onSubmit: (v) => { att.items.push({ name: v.name, meta: `Contato · ${v.phone}`, icon: 'user' }); paintTray(); } });
    const askLocation = () => askForm({ title: 'Enviar localização', submit: 'Anexar',
      fields: [{ name: 'address', label: 'Endereço', required: true, help: 'Ex.: Av. Paulista, 1000 · Bela Vista · São Paulo · SP' }],
      onSubmit: (v) => { att.items.push({ name: v.address, meta: 'Localização', icon: 'pin' }); paintTray(); } });
    if (!isNote) paintTray();
    const go = h('button', { class: 'send-btn', 'aria-label': label, title: label, onclick: () => {
      if (!isNote && att.items.length) { err.textContent = 'Envio de mídia ainda não está disponível neste servidor. Remova o anexo para enviar só o texto.'; return; }
      if (ta.value.trim()) send({ kind, body: ta.value }, go);
    } }, icon('send'));
    const grow = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`; };

    // balões acima da barra: emoji, anexos (mídia ainda não existe) e respostas rápidas
    const emojiPop = h('div', { class: 'pop emoji hidden', role: 'group', 'aria-label': 'Emojis' },
      EMOJIS.map((e) => h('button', { type: 'button', 'aria-label': `Inserir ${e}`, onclick: () => {
        const at = ta.selectionStart ?? ta.value.length;
        ta.setRangeText(e, at, ta.selectionEnd ?? at, 'end'); ta.focus(); grow(); emojiPop.classList.add('hidden');
      } }, e)));
    const attachPop = h('div', { class: 'pop attach hidden', role: 'menu', 'aria-label': 'Anexar' },
      [['image', 'Imagens e vídeos', () => pick('image/*,video/*', 'image', 'Imagem ou vídeo')],
        ['file', 'Documentos', () => pick('.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv', 'file', 'Documento')],
        ['user', 'Contato', askContact], ['pin', 'Localização', askLocation]].map(([ic, l, fn]) => h('button', { type: 'button', role: 'menuitem', onclick: () => { attachPop.classList.add('hidden'); fn(); } }, icon(ic), l)),
      h('span', { class: 'help' }, 'Por enquanto o anexo só é pré-visualizado: o envio depende da integração de mídia do WhatsApp.'),
      h('hr'),
      h('button', { type: 'button', role: 'menuitem', class: 'note-item', onclick: () => { state.tab = 'note'; draw(); } }, icon('lock'), 'Nota interna'));
    const qr = h('div', { class: 'pop qr hidden', role: 'listbox', 'aria-label': 'Respostas rápidas' });
    let qrItems = []; let qrIdx = 0;
    const qrPaint = () => qr.replaceChildren(...qrItems.map((r, i) => h('button', { type: 'button', role: 'option', 'aria-selected': String(i === qrIdx), class: i === qrIdx ? 'on' : '',
      onmousedown: (ev) => { ev.preventDefault(); qrPick(r); } }, h('b', {}, `/${r.shortcut}`), h('span', { class: 'muted' }, r.body))));
    const qrPick = (r) => { ta.value = r.body; qr.classList.add('hidden'); qrItems = []; ta.focus(); grow(); };
    const qrUpdate = () => {
      const m = isNote ? null : /^\/([a-z0-9_]*)$/i.exec(ta.value);
      qrItems = m ? state.quickReplies.filter((r) => r.shortcut.startsWith(m[1].toLowerCase())).slice(0, 6) : [];
      qrIdx = 0;
      if (m && !qrItems.length) { qr.replaceChildren(h('span', { class: 'help' }, state.quickReplies.length ? 'Nenhuma resposta com esse atalho.' : 'Ainda não há respostas rápidas. Um administrador pode cadastrar em Administração.')); }
      else qrPaint();
      qr.classList.toggle('hidden', !m);
    };
    const toggle = (pop, other) => { other.classList.add('hidden'); qr.classList.add('hidden'); pop.classList.toggle('hidden'); };
    ta.addEventListener('input', () => { grow(); qrUpdate(); });
    ta.addEventListener('keydown', (e) => {
      if (qrItems.length && !qr.classList.contains('hidden')) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); qrIdx = (qrIdx + (e.key === 'ArrowDown' ? 1 : -1) + qrItems.length) % qrItems.length; qrPaint(); return; }
        if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') { e.preventDefault(); qrPick(qrItems[qrIdx]); return; }
        if (e.key === 'Escape') { e.preventDefault(); qr.classList.add('hidden'); return; }
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); go.click(); }
    });
    requestAnimationFrame(grow);
    const emojiBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Emojis', 'aria-haspopup': 'true', title: 'Emojis', onclick: () => toggle(emojiPop, attachPop) }, icon('smile'));
    const attachBtn = isNote ? null : h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Anexar', 'aria-haspopup': 'menu', title: 'Anexar', onclick: () => toggle(attachPop, emojiPop) }, icon('plus'));
    return [h('div', { class: 'sendwrap' }, isNote ? null : tray, emojiPop, attachPop, qr,
      h('div', { class: `sendbar ${isNote ? 'note' : ''}` }, emojiBtn, attachBtn, ta, go)),
    h('span', { class: 'help' }, isNote ? 'Visível só para a equipe · Enter salva' : 'Enter envia · Shift+Enter quebra a linha · "/" abre respostas rápidas')];
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
        : win.open ? textBox(matchMedia('(max-width: 560px)').matches ? 'Escreva uma mensagem…' : 'Escreva uma mensagem ou digite / para respostas rápidas', 'text') : [h('div', { class: 'closed-hint' }, h('span', {}, 'Janela de 24 h encerrada: só template aprovado.'),
          h('button', { class: 'btn small', onclick: () => { state.tab = 'template'; draw(); } }, 'Usar template'))];
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
  const holder = h('div', {}, loading());
  const count = h('span', { class: 'muted count-label', role: 'status' });
  const msg = h('div', { class: 'err', role: 'alert' });
  const search = h('input', { type: 'search', placeholder: 'Buscar por nome ou telefone', 'aria-label': 'Buscar clientes' });
  const openChat = async (r, btn) => {
    msg.textContent = ''; btn.disabled = true;
    try { const { id } = await api('POST', '/api/conversations', { phone: r.phone }); location.hash = `#/inbox/${id}`; }
    catch (e) { msg.textContent = e.message; btn.disabled = false; }
  };
  const load = async () => {
    try {
      const rows = await api('GET', `/api/customers?q=${encodeURIComponent(search.value)}`);
      count.textContent = `${rows.length} ${rows.length === 1 ? 'cliente' : 'clientes'}`;
      holder.replaceChildren(rows.length
        ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Nome'), h('th', {}, 'Telefone'), h('th', {}, 'Conversas'), h('th', { class: 'right' }, 'Ações'))),
          h('tbody', {}, rows.map((r) => { const btn = h('button', { class: 'btn ghost small', onclick: () => openChat(r, btn) }, icon('chat'), ' Abrir conversa');
            return h('tr', {},
              h('td', {}, h('div', { class: 'cell-person' }, h('div', { class: 'avatar md', 'aria-hidden': 'true' }, initials(r.name)), h('a', { href: `#/customers/${r.id}` }, r.name))),
              h('td', {}, fmtPhone(r.phone)), h('td', {}, String(r.conversations)), h('td', { class: 'right actions' }, btn)); }))))
        : empty('Nenhum cliente encontrado', 'Clientes aparecem aqui quando enviam a primeira mensagem.'));
    } catch (e) { holder.replaceChildren(h('div', { class: 'err', role: 'alert' }, e.message)); }
  };
  let t; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); });
  main.append(h('div', { class: 'page wide' }, h('div', { class: 'page-head' }, h('h2', {}, 'Clientes'),
    h('div', { class: 'page-tools' }, count, h('label', { class: 'search' }, icon('search'), search))), msg, holder));
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

// ---------- componentes (modo de testes): todos os balões de mídia do Figma ----------
function componentsView(main) {
  if (state.me.waMode !== 'mock') return main.append(h('div', { class: 'page' }, empty('Indisponível', 'Esta página existe só no modo de testes.')));
  const samples = [
    { type: 'image', caption: 'Segue o comprovante do pagamento.' }, { type: 'video', duration: '0:42' }, { type: 'audio', duration: '0:23' },
    { type: 'document', name: 'Contrato-servico.pdf', meta: 'PDF · 248 KB' }, { type: 'sticker' },
    { type: 'location', address: 'Av. Paulista, 1000', area: 'Bela Vista · São Paulo · SP' }, { type: 'contact', name: 'Marcos Prado', phone: '+55 11 97777-0001' },
    { type: 'loading' }, { type: 'error' },
  ];
  const row = (out) => h('div', { class: 'media-grid' }, samples.map((md) => h('div', { class: `msg ${out ? 'out' : ''} media ${md.type}` }, mediaBody(md),
    h('div', { class: 'info' }, out ? 'Administrador · 11:14 · ✓✓ lida' : '11:14'))));
  main.append(h('div', { class: 'page wide' }, h('h2', {}, 'Mensagens de mídia'),
    h('p', { class: 'muted' }, 'Visual dos balões que o backend de mídia (Sprint 5) vai alimentar. Não aparece para o cliente final.'),
    h('h3', {}, 'Recebidas'), row(false), h('h3', {}, 'Enviadas'), row(true)));
}

// ---------- indicadores ----------
async function metricsView(main) {
  const f = { from: '', to: '', weekend: '' };
  const out = h('div', {}, loading());
  const load = async () => {
    let m;
    try { m = await api('GET', `/api/metrics?${new URLSearchParams(Object.entries(f).filter(([, v]) => v))}`); }
    catch (e) { out.replaceChildren(h('div', { class: 'err', role: 'alert' }, e.message)); return; }
    const kpi = (label, v, ic, tone = '') => h('div', { class: `card kpi ${tone}` }, h('div', { class: 'kpi-top' }, h('span', { class: 'v' }, String(v)), icon(ic)), h('div', { class: 'muted' }, label));
    const days = m.perDay;
    const max = Math.max(1, ...days.map((r) => r.count));
    const vbars = h('div', { class: 'vbars', role: 'img', 'aria-label': 'Conversas por dia' }, days.map((r) => {
      const bar = h('i', { class: 'bar-v' }); bar.style.height = `${Math.max(3, (r.count / max) * 150)}px`;
      return h('div', { class: 'vcol' }, h('b', {}, String(r.count)), bar, h('small', {}, r.day.slice(8) + '/' + r.day.slice(5, 7)));
    }));
    const maxAgent = Math.max(1, ...m.perAgent.map((r) => r.count));
    const hbars = h('div', {}, m.perAgent.map((r) => {
      const fill = h('i'); fill.style.width = `${(r.count / maxAgent) * 100}%`;
      return h('div', { class: 'hrow' }, h('span', {}, r.agent), h('div', { class: 'track' }, fill), h('b', {}, String(r.count)));
    }));
    out.replaceChildren(
      h('div', { class: 'kpis' }, kpi('Conversas', m.total, 'chat'), kpi('Aguardando', m.byStatus.open, 'clock', 'warn'), kpi('Em atendimento', m.byStatus.in_progress, 'users'), kpi('Resolvidas', m.byStatus.resolved, 'checkc', 'ok'),
        kpi('1ª resposta (média)', fmtDur(m.firstResponse.avgSeconds), 'bolt', 'mute'), kpi('1ª resposta (mediana)', fmtDur(m.firstResponse.medianSeconds), 'bolt', 'mute'),
        kpi('Resolução (média)', fmtDur(m.resolution.avgSeconds), 'checkc', 'mute')),
      h('div', { class: 'charts' },
        h('section', { class: 'panel' }, h('h3', {}, 'Conversas por dia'), days.length ? vbars : empty('Sem dados no período')),
        h('section', { class: 'panel' }, h('h3', {}, 'Por responsável'), m.perAgent.length ? hbars : empty('Sem dados no período'))));
  };
  const on = (k, el) => { el.addEventListener('change', () => { f[k] = el.value; load(); }); return el; };
  main.append(h('div', { class: 'page wide' }, h('h2', {}, 'Indicadores'),
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
    const users = h('div', { class: 'section' }, h('div', { class: 'sec-head' }, h('h3', {}, 'Usuários'), h('button', { class: 'btn', onclick: newUser }, 'Novo usuário')),
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
    const teams = h('div', { class: 'section' }, h('div', { class: 'sec-head' }, h('h3', {}, 'Equipes'), h('button', { class: 'btn', onclick: newTeam }, 'Nova equipe')),
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
    const templates = h('div', { class: 'section' }, h('div', { class: 'sec-head' }, h('h3', {}, 'Templates do WhatsApp'), h('button', { class: 'btn', onclick: newTemplate }, 'Novo template')),
      h('p', { class: 'muted' }, 'Fora da janela de 24 h só é possível enviar templates aprovados pela Meta.'),
      state.templates.length ? tableWrap(h('tbody', {}, state.templates.map((t) => h('tr', {}, h('td', {}, `${t.name} (${t.language})`), h('td', {}, t.body),
        h('td', { class: 'actions' }, h('button', { class: 'btn ghost small', onclick: after(() => api('PATCH', `/api/templates/${t.id}`, { active: !t.active })) }, t.active ? 'Desativar' : 'Ativar'))))))
        : empty('Nenhum template', 'Cadastre os templates aprovados na Meta.'));

    // auditoria
    const log = h('div', { class: 'section' }, h('h3', {}, 'Auditoria (últimos 200 eventos)'),
      audit.length ? tableWrap(h('tbody', {}, audit.map((a) => h('tr', {}, h('td', {}, fmtTime(a.created_at)), h('td', {}, a.user_name ?? 'sistema / e-mail'), h('td', {}, a.action), h('td', { class: 'muted' }, `${a.entity} #${a.entity_id ?? ''}`)))))
        : empty('Nada registrado ainda'));
    // respostas rápidas ("/" no compositor)
    const newQuick = () => askForm({
      title: 'Nova resposta rápida', intro: 'No compositor, digite "/" e o atalho para inserir o texto.', submit: 'Adicionar',
      fields: [{ name: 'shortcut', label: 'Atalho', required: true, help: 'minúsculas, números e _ (sem a barra), ex.: bomdia' },
        { name: 'body', label: 'Texto', type: 'textarea', required: true },
        { name: 'teamId', label: 'Disponível para', type: 'select', value: '', options: [['', 'Todos'], ...teamOptions] }],
      onSubmit: after((v) => api('POST', '/api/quick-replies', { shortcut: v.shortcut, body: v.body, teamId: v.teamId ? Number(v.teamId) : null })),
    });
    const quick = h('div', { class: 'section' }, h('div', { class: 'sec-head' }, h('h3', {}, 'Respostas rápidas'), h('button', { class: 'btn', onclick: newQuick }, 'Nova resposta')),
      h('p', { class: 'muted' }, 'Textos prontos que o atendente insere digitando "/" no campo de mensagem.'),
      state.quickReplies.length ? tableWrap(h('thead', {}, h('tr', {}, ['Atalho', 'Texto', 'Disponível para', ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, state.quickReplies.map((r) => h('tr', {}, h('td', {}, h('b', {}, `/${r.shortcut}`)), h('td', {}, r.body), h('td', {}, teamName(r.team_id) ?? 'Todos'),
          h('td', { class: 'actions' }, h('button', { class: 'btn ghost small', onclick: () => confirmAction('Excluir resposta rápida', `O atalho /${r.shortcut} deixará de existir.`, 'Excluir', after(() => api('DELETE', `/api/quick-replies/${r.id}`))) }, 'Excluir'))))))
        : empty('Nenhuma resposta rápida', 'Cadastre textos que a equipe usa com frequência.'));

    // abas da Administração (cadastros pendentes ficam sempre no topo)
    const TABS = [['users', 'Usuários', users], ['teams', 'Equipes', teams], ['templates', 'Templates do WhatsApp', templates], ['quick', 'Respostas rápidas', quick], ['audit', 'Auditoria', log]];
    const cur = TABS.find(([k]) => k === state.adminTab) ?? TABS[0];
    const tabs = h('div', { class: 'tabs page-tabs', role: 'tablist', 'aria-label': 'Seções da administração' }, TABS.map(([k, l]) => h('button', {
      class: k === cur[0] ? 'on' : '', role: 'tab', 'aria-selected': String(k === cur[0]), onclick: () => { state.adminTab = k; reload(); },
    }, l)));
    return [pend, tabs, cur[2]].filter(Boolean);
  }
  reload();
}

boot();
