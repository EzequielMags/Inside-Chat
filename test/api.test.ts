import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { openDb } from '../src/db.ts';
import { config } from '../src/config.ts';
import { buildApp } from '../src/app.ts';
import { MockChannel } from '../src/channels/whatsapp.ts';
import { hashPassword } from '../src/auth.ts';
import { ingestInbound, localDow } from '../src/domain.ts';

const db = openDb(':memory:');
const channel = new MockChannel();
let app: Awaited<ReturnType<typeof buildApp>>;

const H = { 'x-requested-with': 'cordial' };
const cookies: Record<string, string> = {};

async function login(email: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { email, password: 'senha-forte-1' } });
  assert.equal(res.statusCode, 200);
  cookies[email] = `cordial_sid=${res.cookies[0].value}`;
}
const call = (email: string, method: any, url: string, payload?: unknown) =>
  app.inject({ method, url, headers: { ...H, cookie: cookies[email] }, payload: payload as any });

before(async () => {
  app = await buildApp({ db, channel });
  const pw = hashPassword('senha-forte-1');
  const add = (n: string, e: string, r: string) => db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)').run(n, e, pw, r);
  add('Admin', 'admin@t.com', 'admin'); add('Ana', 'ana@t.com', 'agent'); add('Bia', 'bia@t.com', 'agent');
  db.prepare("INSERT INTO teams (name) VALUES ('A'),('B')").run();
  db.prepare('INSERT INTO team_members VALUES (1,2)').run();
  db.prepare('INSERT INTO team_members VALUES (2,3)').run();
  db.prepare("INSERT INTO templates (name,language,body) VALUES ('retorno','pt_BR','Olá {{1}}!')").run();
  for (const e of ['admin@t.com', 'ana@t.com', 'bia@t.com']) await login(e);
});

test('auth: exige sessão, CSRF header e rejeita senha errada', async () => {
  assert.equal((await app.inject({ method: 'GET', url: '/api/conversations' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'a', password: 'b' } })).statusCode, 403);
  const bad = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { email: 'ana@t.com', password: 'errada' } });
  assert.equal(bad.statusCode, 401);
});

test('mensagem recebida cria cliente+conversa e é idempotente', () => {
  const a = ingestInbound(db, { channel: 'whatsapp', phone: '+55 (11) 90000-0001', contactName: 'Cliente 1', body: 'oi', externalId: 'w1' });
  const b = ingestInbound(db, { channel: 'whatsapp', phone: '5511900000001', body: 'oi', externalId: 'w1' });
  assert.equal(b.duplicate, true);
  assert.ok(a.conversationId > 0);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM messages WHERE external_id = ?').get('w1') as any).n, 1);
});

test('permissões: agente de outra equipe não vê conversa da equipe; admin vê', async () => {
  const { conversationId } = ingestInbound(db, { channel: 'whatsapp', phone: '5511900000002', body: 'x', externalId: 'w2' });
  // atribui à equipe A (Ana)
  assert.equal((await call('admin@t.com', 'PATCH', `/api/conversations/${conversationId}`, { teamId: 1 })).statusCode, 200);
  assert.equal((await call('ana@t.com', 'GET', `/api/conversations/${conversationId}`)).statusCode, 200);
  assert.equal((await call('bia@t.com', 'GET', `/api/conversations/${conversationId}`)).statusCode, 404);
  const list = (await call('bia@t.com', 'GET', '/api/conversations')).json();
  assert.ok(!list.some((c: any) => c.id === conversationId));
  assert.equal((await call('ana@t.com', 'POST', '/api/users', {})).statusCode, 403);
});

test('janela de 24h: texto livre bloqueado fora da janela, template permitido; nota nunca vai ao canal', async () => {
  const { conversationId } = ingestInbound(db, {
    channel: 'whatsapp', phone: '5511900000003', body: 'antigo', externalId: 'w3', timestamp: new Date(Date.now() - 30 * 3600_000),
  });
  const sentBefore = channel.sent.length;
  const blocked = await call('ana@t.com', 'POST', `/api/conversations/${conversationId}/messages`, { kind: 'text', body: 'olá' });
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.json().code, 'window_closed');

  const note = await call('ana@t.com', 'POST', `/api/conversations/${conversationId}/messages`, { kind: 'note', body: 'interno' });
  assert.equal(note.statusCode, 201);
  assert.equal(channel.sent.length, sentBefore);

  const tpl = await call('ana@t.com', 'POST', `/api/conversations/${conversationId}/messages`, { kind: 'template', templateId: 1, params: ['Maria'] });
  assert.equal(tpl.statusCode, 201);
  assert.equal(tpl.json().body, 'Olá Maria!');
  assert.equal(channel.sent.at(-1)!.body, 'template:retorno(Maria)');
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId) as any;
  assert.equal(conv.status, 'in_progress');
  assert.ok(conv.first_response_at);
});

test('resposta dentro da janela atribui ao respondente e entra em andamento', async () => {
  const { conversationId } = ingestInbound(db, { channel: 'whatsapp', phone: '5511900000004', body: 'oi', externalId: 'w4' });
  const r = await call('bia@t.com', 'POST', `/api/conversations/${conversationId}/messages`, { kind: 'text', body: 'Olá!' });
  assert.equal(r.statusCode, 201);
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId) as any;
  assert.equal(conv.assignee_id, 3);
  assert.equal(conv.status, 'in_progress');
  // resolvida: nova mensagem do cliente abre outra conversa
  await call('bia@t.com', 'PATCH', `/api/conversations/${conversationId}`, { status: 'resolved' });
  const again = ingestInbound(db, { channel: 'whatsapp', phone: '5511900000004', body: 'voltei', externalId: 'w4b' });
  assert.notEqual(again.conversationId, conversationId);
});

test('filtro de plantão: sábado/domingo no fuso local', async () => {
  // 2026-01-03 é sábado; 2026-01-04 domingo; 2026-01-05 segunda (12:00 local = 15:00Z)
  const mk = (phone: string, day: string, ext: string) =>
    ingestInbound(db, { channel: 'whatsapp', phone, body: 'plantão', externalId: ext, timestamp: new Date(`${day}T12:00:00-03:00`) }).conversationId;
  const sat = mk('5511911110001', '2026-01-03', 'p1');
  const sun = mk('5511911110002', '2026-01-04', 'p2');
  const mon = mk('5511911110003', '2026-01-05', 'p3');
  assert.equal(localDow(new Date('2026-01-03T23:30:00-03:00')), 6); // fuso local, não UTC
  const ids = async (q: string) => (await call('admin@t.com', 'GET', `/api/conversations?${q}`)).json().map((c: any) => c.id);
  const both = await ids('weekend=both&from=2026-01-01&to=2026-01-31');
  assert.ok(both.includes(sat) && both.includes(sun) && !both.includes(mon));
  const onlySun = await ids('weekend=sun&from=2026-01-01&to=2026-01-31');
  assert.deepEqual(onlySun.filter((i: number) => [sat, sun, mon].includes(i)), [sun]);
});

test('webhook: verificação de token e assinatura HMAC', async () => {
  config.whatsapp.verifyToken = 'tok-123';
  config.whatsapp.appSecret = 'segredo';
  const ok = await app.inject({ method: 'GET', url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=tok-123&hub.challenge=42' });
  assert.equal(ok.body, '42');
  assert.equal((await app.inject({ method: 'GET', url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=x&hub.challenge=42' })).statusCode, 403);

  const payload = JSON.stringify({ entry: [{ changes: [{ value: {
    contacts: [{ wa_id: '5511977770000', profile: { name: 'Via Webhook' } }],
    messages: [{ id: 'wamid.A', from: '5511977770000', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'oi webhook' } }],
  } }] }] });
  const sig = 'sha256=' + createHmac('sha256', 'segredo').update(payload).digest('hex');
  const headers = { 'content-type': 'application/json' };
  assert.equal((await app.inject({ method: 'POST', url: '/webhooks/whatsapp', headers: { ...headers, 'x-hub-signature-256': 'sha256=00' }, payload })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/webhooks/whatsapp', headers, payload })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/webhooks/whatsapp', headers: { ...headers, 'x-hub-signature-256': sig }, payload })).statusCode, 200);
  assert.equal((db.prepare("SELECT name FROM customers WHERE phone = '5511977770000'").get() as any).name, 'Via Webhook');

  // status: não rebaixa read -> delivered
  const st = (status: string) => JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.A', status }] } }] }] });
  db.prepare("UPDATE messages SET delivery_status = 'sent' WHERE external_id = 'wamid.A'").run();
  for (const s of ['read', 'delivered']) {
    const body = st(s);
    await app.inject({ method: 'POST', url: '/webhooks/whatsapp', headers: { ...headers, 'x-hub-signature-256': 'sha256=' + createHmac('sha256', 'segredo').update(body).digest('hex') }, payload: body });
  }
  assert.equal((db.prepare("SELECT delivery_status s FROM messages WHERE external_id = 'wamid.A'").get() as any).s, 'read');
  config.whatsapp.appSecret = '';
});

test('indicadores: contagem e tempo de primeira resposta', async () => {
  const m = (await call('admin@t.com', 'GET', '/api/metrics')).json();
  assert.ok(m.total >= 5);
  assert.ok(m.firstResponse.samples >= 1);
  assert.ok(Array.isArray(m.perDay) && m.perDay.length >= 1);
});

test('ACEITAR: atômico (409 para o segundo), 404 fora da equipe, exige sessão e CSRF', async () => {
  const { conversationId: id } = ingestInbound(db, { channel: 'whatsapp', phone: '5511900000077', body: 'oi', externalId: 'acc1' });
  assert.equal((await call('admin@t.com', 'PATCH', `/api/conversations/${id}`, { teamId: 1 })).statusCode, 200); // equipe A (Ana)
  assert.equal((await app.inject({ method: 'POST', url: `/api/conversations/${id}/accept`, headers: H })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: `/api/conversations/${id}/accept`, headers: { cookie: cookies['ana@t.com'] } })).statusCode, 403); // sem CSRF
  assert.equal((await call('bia@t.com', 'POST', `/api/conversations/${id}/accept`)).statusCode, 404);            // outra equipe não vê
  const ok = await call('ana@t.com', 'POST', `/api/conversations/${id}/accept`);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().status, 'in_progress'); assert.equal(ok.json().assignee_id, 2);
  const again = await call('admin@t.com', 'POST', `/api/conversations/${id}/accept`);                             // já tem dono
  assert.equal(again.statusCode, 409); assert.equal(again.json().code, 'already_taken');
  assert.equal((db.prepare('SELECT assignee_id a FROM conversations WHERE id = ?').get(id) as any).a, 2);        // dono não foi sobrescrito
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'conversation.accept' AND entity_id = ?").get(id));
  assert.equal((await call('ana@t.com', 'POST', '/api/conversations/99999/accept')).statusCode, 404);
});

test('eventos do sistema: registrados na conversa, nunca passam pelo canal nem mudam a prévia', async () => {
  const { conversationId: id } = ingestInbound(db, { channel: 'whatsapp', phone: '5511900000088', body: 'preciso de ajuda', externalId: 'ev1' });
  const sentBefore = channel.sent.length;
  assert.equal((await call('ana@t.com', 'POST', `/api/conversations/${id}/accept`)).statusCode, 200);
  assert.equal((await call('ana@t.com', 'PATCH', `/api/conversations/${id}`, { assigneeId: 1 })).statusCode, 200);
  assert.equal((await call('admin@t.com', 'PATCH', `/api/conversations/${id}`, { status: 'resolved' })).statusCode, 200);
  assert.equal((await call('admin@t.com', 'PATCH', `/api/conversations/${id}`, { status: 'in_progress' })).statusCode, 200);
  const events = (await call('admin@t.com', 'GET', `/api/conversations/${id}`)).json().messages.filter((m: any) => m.kind === 'event').map((m: any) => m.body);
  assert.deepEqual(events, ['Atendimento atribuído a Ana', 'Atendimento atribuído a Admin', 'Admin resolveu a conversa', 'Admin reabriu a conversa']);
  assert.equal(channel.sent.length, sentBefore);
  assert.equal((db.prepare('SELECT last_preview p FROM conversations WHERE id = ?').get(id) as any).p, 'preciso de ajuda');
});

test('busca dentro da conversa: acha texto, ignora eventos, respeita permissão e valida entrada', async () => {
  const { conversationId: id } = ingestInbound(db, { channel: 'whatsapp', phone: '5511900000099', body: 'Quero a segunda via do boleto', externalId: 'sr1' });
  await call('admin@t.com', 'PATCH', `/api/conversations/${id}`, { teamId: 1 });
  const hit = await call('ana@t.com', 'GET', `/api/conversations/${id}/search?q=BOLETO`);
  assert.equal(hit.statusCode, 200); assert.equal(hit.json().ids.length, 1);
  assert.deepEqual((await call('ana@t.com', 'GET', `/api/conversations/${id}/search?q=xyz`)).json().ids, []);
  assert.deepEqual((await call('ana@t.com', 'GET', `/api/conversations/${id}/search?q=${encodeURIComponent('%')}`)).json().ids, []); // % é literal
  assert.deepEqual((await call('ana@t.com', 'GET', `/api/conversations/${id}/search?q=atribuído`)).json().ids, []);                    // evento não entra
  assert.equal((await call('bia@t.com', 'GET', `/api/conversations/${id}/search?q=boleto`)).statusCode, 404);                       // outra equipe
  assert.equal((await call('ana@t.com', 'GET', `/api/conversations/${id}/search`)).statusCode, 400);
});

test('respostas rápidas: só admin cadastra; atendente vê as gerais e as da sua equipe', async () => {
  const mk = (p: object) => call('admin@t.com', 'POST', '/api/quick-replies', p);
  assert.equal((await call('ana@t.com', 'POST', '/api/quick-replies', { shortcut: 'oi', body: 'Olá!' })).statusCode, 403);
  assert.equal((await mk({ shortcut: 'Bom_Dia', body: 'Bom dia! Como posso ajudar?' })).statusCode, 201);
  assert.equal((await mk({ shortcut: 'so_a', body: 'Só equipe A', teamId: 1 })).statusCode, 201);
  assert.equal((await mk({ shortcut: 'so_b', body: 'Só equipe B', teamId: 2 })).statusCode, 201);
  assert.equal((await mk({ shortcut: 'bom_dia', body: 'repetido' })).statusCode, 409);
  assert.equal((await mk({ shortcut: 'com espaço', body: 'x' })).statusCode, 400);
  assert.equal((await mk({ shortcut: 'x', body: 'x', teamId: 999 })).statusCode, 400);
  const names = async (u: string) => (await call(u, 'GET', '/api/quick-replies')).json().map((r: any) => r.shortcut);
  assert.deepEqual(await names('ana@t.com'), ['bom_dia', 'so_a']);
  assert.deepEqual(await names('bia@t.com'), ['bom_dia', 'so_b']);
  assert.deepEqual(await names('admin@t.com'), ['bom_dia', 'so_a', 'so_b']);
});

test('nova conversa: não revela atendimento aberto de outra equipe', async () => {
  const { conversationId: id } = ingestInbound(db, { channel: 'whatsapp', phone: '5511900000055', body: 'oi', externalId: 'nc1' });
  await call('admin@t.com', 'PATCH', `/api/conversations/${id}`, { teamId: 2 }); // equipe B (Bia)
  const r = await call('ana@t.com', 'POST', '/api/conversations', { phone: '5511900000055' });
  assert.equal(r.statusCode, 409); assert.equal(r.json().code, 'already_open');
  assert.equal((await call('bia@t.com', 'POST', '/api/conversations', { phone: '5511900000055' })).json().id, id);
});
