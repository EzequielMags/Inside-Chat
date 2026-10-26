import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.ts';
import { config } from '../src/config.ts';
import { buildApp } from '../src/app.ts';
import { MockChannel } from '../src/channels/whatsapp.ts';
import { hashPassword } from '../src/auth.ts';
import type { Mail, Mailer } from '../src/mailer.ts';

const db = openDb(':memory:');
const outbox: Mail[] = [];
const mailer: Mailer = { async send(m) { outbox.push(m); } };
let app: Awaited<ReturnType<typeof buildApp>>;
const H = { 'x-requested-with': 'cordial' };
const PW = 'senha-forte-1';
config.approvalEmail = 'aprovador@gmail.test';
config.publicUrl = 'http://app.test';

// IP distinto por chamada: os limitadores por IP não devem interferir nos cenários (há teste próprio para eles).
let n = 0;
const post = (url: string, payload: unknown, headers: Record<string, string> = H) =>
  app.inject({ method: 'POST', url, headers, payload: payload as any, remoteAddress: `10.0.${n >> 8}.${n++ & 255}` });
const linkFrom = (mail: Mail, path: 'verificar' | 'aprovar') => mail.text.match(new RegExp(`/${path}\\?t=([\\w-]+)`))![1];
const mailsTo = (to: string) => outbox.filter((m) => m.to === to);
const signup = (email: string, name = 'Novo Usuário') => post('/api/auth/signup', { name, email });
const verify = (token: string, password = PW) => post('/api/auth/verify', { token, password });
const login = (email: string, password = PW) => post('/api/auth/login', { email, password });
const backdateSends = (email: string) =>
  db.prepare("UPDATE signup_approvals SET created_at = '2020-01-01T00:00:00.000Z' WHERE user_id = (SELECT id FROM users WHERE email = ?)").run(email);
/** Cadastra e confirma o e-mail (definindo a senha); devolve o token de aprovação enviado ao aprovador. */
async function signupVerified(email: string) {
  await signup(email);
  assert.equal((await verify(linkFrom(mailsTo(email).at(-1)!, 'verificar'))).statusCode, 200);
  return linkFrom(mailsTo('aprovador@gmail.test').at(-1)!, 'aprovar');
}

before(async () => {
  app = await buildApp({ db, channel: new MockChannel(), mailer });
  db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)').run('Admin', 'admin@t.com', hashPassword(PW), 'admin');
});

test('cadastro: pendente, confirma e-mail e define a senha com o solicitante, só então avisa o aprovador', async () => {
  assert.equal((await signup('Novo@T.com')).statusCode, 202);
  const u = db.prepare("SELECT * FROM users WHERE email = 'novo@t.com'").get() as any;
  assert.equal(u.status, 'pending'); assert.equal(u.active, 0); assert.equal(u.role, 'agent'); assert.equal(u.email_verified_at, null);

  assert.equal(mailsTo('novo@t.com').length, 1);
  assert.match(mailsTo('novo@t.com')[0].text, /http:\/\/app\.test\/verificar\?t=/);
  assert.equal(mailsTo('aprovador@gmail.test').length, 0);

  // sem confirmar não existe senha utilizável: 401 genérico (não revela a conta)
  assert.equal((await login('novo@t.com')).statusCode, 401);

  // o token de verificação não serve como aprovação
  const vt = linkFrom(mailsTo('novo@t.com')[0], 'verificar');
  assert.equal((await post('/api/auth/approval', { token: vt, decision: 'approve' })).statusCode, 410);

  assert.equal((await post('/api/auth/verify', { token: vt, password: PW }, {})).statusCode, 403); // exige CSRF
  assert.equal((await post('/api/auth/verify', { token: vt, password: '' })).statusCode, 400); // vazia continua inválida
  assert.equal((await post('/api/auth/verify', { token: vt })).statusCode, 400); // senha obrigatória
  assert.equal((await verify(vt)).statusCode, 200);
  assert.equal((await verify(vt)).statusCode, 410); // uso único
  assert.equal(mailsTo('aprovador@gmail.test').length, 1);
  assert.match(mailsTo('aprovador@gmail.test')[0].text, /http:\/\/app\.test\/aprovar\?t=/);
  const l2 = await login('novo@t.com');
  assert.equal(l2.statusCode, 403); assert.equal(l2.json().code, 'pending');
});

test('pré-sequestro: o atacante não conhece a senha da conta nem herda a confirmação da vítima', async () => {
  await signup('vitima@t.com', 'Atacante Esperto');
  const attackerLink = linkFrom(mailsTo('vitima@t.com')[0], 'verificar');
  // nenhuma senha escolhida pelo atacante existe; tentar entrar é impossível
  assert.equal((await login('vitima@t.com', 'qualquer-senha-1')).statusCode, 401);

  // a vítima faz o próprio cadastro depois (5 min): o nome dela vale e o link antigo morre
  backdateSends('vitima@t.com');
  await signup('vitima@t.com', 'Vítima Real');
  assert.equal((db.prepare("SELECT name FROM users WHERE email = 'vitima@t.com'").get() as any).name, 'Vítima Real');
  assert.equal((await verify(attackerLink, 'senha-do-atacante-1')).statusCode, 410);

  // quem confirma escolhe a senha: só ela vale
  assert.equal((await verify(linkFrom(mailsTo('vitima@t.com').at(-1)!, 'verificar'), 'senha-da-vitima-1')).statusCode, 200);
  assert.equal((await login('vitima@t.com', 'senha-do-atacante-1')).statusCode, 401);
  assert.equal((await login('vitima@t.com', 'senha-da-vitima-1')).statusCode, 403); // senha certa, ainda pendente
});

test('cadastro público não concede privilégio nem aceita campos extras', async () => {
  assert.equal((await post('/api/auth/signup', { name: 'Hacker', email: 'h@t.com', role: 'admin' })).statusCode, 400);
  assert.equal((await post('/api/auth/signup', { name: 'Hacker', email: 'h@t.com', password: PW })).statusCode, 400); // senha não é aceita aqui
  assert.equal((await signup('nao-e-email')).statusCode, 400);
  assert.equal((await post('/api/auth/signup', { name: 'Fulano', email: 'f@t.com' }, {})).statusCode, 403);
});

test('e-mail já existente recebe a mesma resposta e não gera e-mail novo', async () => {
  const before = outbox.length;
  assert.equal((await signup('admin@t.com')).statusCode, 202);
  assert.equal((await signup('novo@t.com')).statusCode, 202); // já confirmado, aguardando aprovação
  assert.equal(outbox.length, before);
  assert.equal((db.prepare("SELECT role FROM users WHERE email = 'admin@t.com'").get() as any).role, 'admin');
});

test('reenvio: 1 e-mail a cada 5 min, no máximo 3 por cadastro; link antigo é invalidado', async () => {
  await signup('re@t.com'); await signup('re@t.com');
  assert.equal(mailsTo('re@t.com').length, 1);
  for (let i = 0; i < 4; i++) { backdateSends('re@t.com'); await signup('re@t.com'); }
  assert.equal(mailsTo('re@t.com').length, 3); // teto
  assert.equal((await verify(linkFrom(mailsTo('re@t.com')[0], 'verificar'))).statusCode, 410);
  assert.equal((await verify(linkFrom(mailsTo('re@t.com')[2], 'verificar'))).statusCode, 200);
});

test('cadastros nunca confirmados expiram e liberam o e-mail', async () => {
  await signup('velho@t.com');
  db.prepare("UPDATE users SET created_at = '2020-01-01T00:00:00.000Z' WHERE email = 'velho@t.com'").run();
  await signup('outro@t.com'); // dispara a limpeza
  assert.equal(db.prepare("SELECT 1 FROM users WHERE email = 'velho@t.com'").get(), undefined);
  await signup('velho@t.com');
  assert.ok(db.prepare("SELECT 1 FROM users WHERE email = 'velho@t.com'").get());
});

test('link do aprovador: consulta, aprova uma única vez e libera o login', async () => {
  const token = linkFrom(mailsTo('aprovador@gmail.test')[0], 'aprovar');
  const info = await app.inject({ method: 'GET', url: `/api/auth/approval?t=${token}` });
  assert.equal(info.statusCode, 200);
  assert.equal(info.json().email, 'novo@t.com');
  assert.equal((await app.inject({ method: 'GET', url: '/api/auth/approval?t=token-invalido-token-invalido' })).statusCode, 410);
  assert.equal((await post('/api/auth/approval', { token, decision: 'approve' }, {})).statusCode, 403);

  assert.equal((await post('/api/auth/approval', { token, decision: 'approve' })).statusCode, 200);
  assert.equal((await post('/api/auth/approval', { token, decision: 'approve' })).statusCode, 410);
  assert.equal((await login('novo@t.com')).statusCode, 200);
  assert.ok(mailsTo('novo@t.com').some((m) => /aprovado/i.test(m.subject)));
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'signup.approve'").get());
});

test('recusar bloqueia o login; token expirado não vale', async () => {
  const token = await signupVerified('rec@t.com');
  assert.equal((await post('/api/auth/approval', { token, decision: 'reject' })).statusCode, 200);
  const l = await login('rec@t.com');
  assert.equal(l.statusCode, 403); assert.equal(l.json().code, 'rejected');

  const t2 = await signupVerified('exp@t.com');
  db.prepare("UPDATE signup_approvals SET expires_at = '2020-01-01T00:00:00.000Z'").run();
  assert.equal((await post('/api/auth/approval', { token: t2, decision: 'approve' })).statusCode, 410);
  assert.equal((await login('exp@t.com')).statusCode, 403);
});

test('admin reabre cadastro recusado: volta a pendente, sem acesso, e pode ser aprovado depois', async () => {
  const token = await signupVerified('reab@t.com');
  assert.equal((await post('/api/auth/approval', { token, decision: 'reject' })).statusCode, 200);
  assert.equal((await signup('reab@t.com')).statusCode, 202); // recusado continua bloqueado no cadastro público
  assert.equal(mailsTo('reab@t.com').filter((m) => /confirme/i.test(m.subject)).length, 1);

  const id = (db.prepare("SELECT id FROM users WHERE email = 'reab@t.com'").get() as any).id;
  const adm = (await login('admin@t.com')).cookies[0].value;
  const ag = (await login('novo@t.com')).cookies[0].value;
  const as = (cookie: string, url: string, payload: unknown = {}, method: any = 'POST') =>
    app.inject({ method, url, headers: { ...H, cookie: `cordial_sid=${cookie}` }, payload: payload as any });

  assert.equal((await as(ag, `/api/users/${id}/reopen`)).statusCode, 403);          // só admin
  assert.equal((await as(adm, '/api/users/99999/reopen')).statusCode, 404);
  assert.equal((await post(`/api/users/${id}/reopen`, {}, {})).statusCode, 403);    // CSRF
  const r = await as(adm, `/api/users/${id}/reopen`);
  assert.equal(r.statusCode, 200); assert.equal(r.json().verified, true);
  assert.equal((await as(adm, `/api/users/${id}/reopen`)).statusCode, 404);          // já não está recusado

  const u = db.prepare('SELECT status, active FROM users WHERE id = ?').get(id) as any;
  assert.equal(u.status, 'pending'); assert.equal(u.active, 0);
  const l = await login('reab@t.com');
  assert.equal(l.statusCode, 403); assert.equal(l.json().code, 'pending');           // reabrir não dá acesso
  assert.equal((await as(adm, `/api/users/${id}/approval`, { decision: 'approve' })).statusCode, 200);
  assert.equal((await login('reab@t.com')).statusCode, 200);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'signup.reopen' AND entity_id = ?").get(id));
  const notice = mailsTo('reab@t.com').find((m) => /reaberto/i.test(m.subject))!;
  assert.ok(notice); assert.doesNotMatch(notice.text, /\?t=/); // avisa o solicitante, sem nenhum link/token
});

test('reabrir cadastro recusado antes de confirmar e-mail exige novo pedido; o antigo link não vale', async () => {
  await signup('reab2@t.com');
  const oldLink = linkFrom(mailsTo('reab2@t.com')[0], 'verificar');
  const id = (db.prepare("SELECT id FROM users WHERE email = 'reab2@t.com'").get() as any).id;
  const adm = (await login('admin@t.com')).cookies[0].value;
  const as = (url: string, payload: unknown = {}) => app.inject({ method: 'POST', url, headers: { ...H, cookie: `cordial_sid=${adm}` }, payload: payload as any });
  assert.equal((await as(`/api/users/${id}/approval`, { decision: 'reject' })).statusCode, 200);
  assert.equal((await verify(oldLink)).statusCode, 410); // recusar invalidou o link
  assert.equal((await as(`/api/users/${id}/reopen`)).json().verified, false);
  assert.equal((await as(`/api/users/${id}/approval`, { decision: 'approve' })).statusCode, 409); // ainda sem e-mail confirmado
  backdateSends('reab2@t.com');
  await signup('reab2@t.com'); // refaz o pedido
  assert.equal((await verify(linkFrom(mailsTo('reab2@t.com').at(-1)!, 'verificar'))).statusCode, 200);
});

test('limite de cadastros por IP', async () => {
  const same = (i: number) => app.inject({ method: 'POST', url: '/api/auth/signup', headers: H, remoteAddress: '203.0.113.9',
    payload: { name: 'Spam', email: `spam${i}@t.com` } });
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await same(i)).statusCode);
  assert.deepEqual(codes, [202, 202, 202, 202, 202, 429, 429]);
});

test('painel do admin: só aprova quem confirmou o e-mail; agente comum não pode; PATCH não reativa pendente', async () => {
  await signup('unv@t.com'); // não confirma
  await signupVerified('pan@t.com');
  const id = (e: string) => (db.prepare('SELECT id FROM users WHERE email = ?').get(e) as any).id;
  const adm = (await login('admin@t.com')).cookies[0].value;
  const ag = (await login('novo@t.com')).cookies[0].value;
  const as = (cookie: string, url: string, payload: unknown, method: any = 'POST') =>
    app.inject({ method, url, headers: { ...H, cookie: `cordial_sid=${cookie}` }, payload: payload as any });

  assert.equal((await as(ag, `/api/users/${id('pan@t.com')}/approval`, { decision: 'approve' })).statusCode, 403);
  assert.equal((await as(adm, `/api/users/${id('pan@t.com')}`, { active: true }, 'PATCH')).statusCode, 400);
  const un = await as(adm, `/api/users/${id('unv@t.com')}/approval`, { decision: 'approve' });
  assert.equal(un.statusCode, 409); assert.equal(un.json().code, 'unverified');
  assert.equal((await as(adm, `/api/users/${id('unv@t.com')}/approval`, { decision: 'reject' })).statusCode, 200); // recusar sempre pode
  assert.equal((await as(adm, `/api/users/${id('pan@t.com')}/approval`, { decision: 'approve' })).statusCode, 200);
  assert.equal((await login('pan@t.com')).statusCode, 200);
  assert.equal((await as(adm, `/api/users/${id('pan@t.com')}/approval`, { decision: 'approve' })).statusCode, 404);
});

test('link de aprovação expirado: reemissão pública vai só ao aprovador, com limite e sem revelar estado', async () => {
  const old = await signupVerified('reemit@t.com');
  const before = mailsTo('aprovador@gmail.test').length;
  const expire = () => db.prepare("UPDATE signup_approvals SET expires_at = '2020-01-01T00:00:00.000Z', created_at = '2020-01-01T00:00:00.000Z' WHERE user_id = (SELECT id FROM users WHERE email = 'reemit@t.com') AND kind = 'approval'").run();
  expire();
  assert.equal((await post('/api/auth/approval', { token: old, decision: 'approve' })).statusCode, 410);

  assert.equal((await post('/api/auth/approval/resend', { token: old }, {})).statusCode, 403);   // CSRF
  assert.equal((await post('/api/auth/approval/resend', { token: 'curto' })).statusCode, 400);
  assert.equal((await post('/api/auth/approval/resend', { token: old })).statusCode, 202);
  const mails = mailsTo('aprovador@gmail.test');
  assert.equal(mails.length, before + 1);
  assert.equal(mailsTo('reemit@t.com').filter((m) => /aprov/i.test(m.subject)).length, 0);       // nunca ao solicitante
  const fresh = linkFrom(mails.at(-1)!, 'aprovar');
  assert.notEqual(fresh, old);

  // limite de 5 min: novo pedido logo em seguida não gera outro e-mail, e responde igual
  assert.equal((await post('/api/auth/approval/resend', { token: old })).statusCode, 202);
  assert.equal(mailsTo('aprovador@gmail.test').length, before + 1);

  // token desconhecido: mesma resposta, nenhum e-mail
  assert.equal((await post('/api/auth/approval/resend', { token: 'x'.repeat(43) })).statusCode, 202);
  assert.equal(mailsTo('aprovador@gmail.test').length, before + 1);

  // o link novo funciona e, depois da decisão, reemitir não faz nada
  assert.equal((await post('/api/auth/approval', { token: fresh, decision: 'reject' })).statusCode, 200);
  expire();
  await post('/api/auth/approval/resend', { token: fresh });
  assert.equal(mailsTo('aprovador@gmail.test').length, before + 1);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'signup.approval_resent'").get());
});
