import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.ts';
import { config, productionProblems, type Config } from '../src/config.ts';
import { buildApp } from '../src/app.ts';
import { MockChannel, WhatsAppCloudChannel, describeGraphError, parseWebhook } from '../src/channels/whatsapp.ts';
import { ChannelError } from '../src/channels/types.ts';
import { ingestInbound, sendMessage } from '../src/domain.ts';
import { backupDb, purgeResolved } from '../src/maintenance.ts';
import { hashPassword } from '../src/auth.ts';

const cfg = { ...config.whatsapp, accessToken: 'tok-secreto', phoneNumberId: '123', apiVersion: 'v21.0' };

function stubFetch(impl: (url: string, init: any) => Promise<Response>) {
  const calls: { url: string; init: any }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => { calls.push({ url: String(url), init }); return impl(String(url), init); }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}
const json = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

test('cloud: envia texto e template no formato da Graph API (sem chamar a Meta)', async () => {
  const f = stubFetch(json(200, { messages: [{ id: 'wamid.X' }] }));
  try {
    const ch = new WhatsAppCloudChannel(cfg);
    assert.equal((await ch.sendText('5511999990000', 'oi')).externalId, 'wamid.X');
    await ch.sendTemplate('5511999990000', { name: 'aviso', language: 'pt_BR' }, ['Ana']);
    assert.equal(f.calls[0].url, 'https://graph.facebook.com/v21.0/123/messages');
    assert.equal(f.calls[0].init.headers.Authorization, 'Bearer tok-secreto');
    const t = JSON.parse(f.calls[1].init.body);
    assert.deepEqual(t.template, { name: 'aviso', language: { code: 'pt_BR' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Ana' }] }] });
  } finally { f.restore(); }
});

test('cloud: erro da Graph API vira texto curto em pt-BR, sem vazar a resposta crua', async () => {
  const f = stubFetch(json(400, { error: { code: 132001, message: 'Template name does not exist in 5511999990000 translation', fbtrace_id: 'abc' } }));
  try {
    await assert.rejects(new WhatsAppCloudChannel(cfg).sendTemplate('5511999990000', { name: 'x', language: 'pt_BR' }, []), (e: any) => {
      assert.ok(e instanceof ChannelError);
      assert.equal(e.message, describeGraphError(132001));
      assert.ok(!e.message.includes('5511999990000') && !e.message.includes('abc'));
      return true;
    });
  } finally { f.restore(); }

  const down = stubFetch(async () => { throw new Error('ECONNRESET 5511999990000'); });
  try {
    await assert.rejects(new WhatsAppCloudChannel(cfg).sendText('5511999990000', 'oi'), (e: any) => e instanceof ChannelError && !e.message.includes('ECONNRESET'));
  } finally { down.restore(); }

  assert.match(describeGraphError(undefined, 401), /Token/);
  assert.match(describeGraphError(999), /código 999/);
});

test('webhook: status failed grava só o texto traduzido', () => {
  const { statuses } = parseWebhook({ entry: [{ changes: [{ value: { statuses: [
    { id: 'w1', status: 'failed', errors: [{ code: 131047, title: 'Re-engagement message', message: 'texto cru com 5511999990000' }] },
    { id: 'w2', status: 'read' },
  ] } }] }] });
  assert.equal(statuses[0].error, describeGraphError(131047));
  assert.equal(statuses[1].error, undefined);
});

test('envio: falha do canal grava failed com texto seguro; erro desconhecido vira genérico', async () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO users (name,email,password_hash,role) VALUES ('A','a@t.com',?, 'admin')").run(hashPassword('senha-forte-1'));
  const user = { id: 1, name: 'A', email: 'a@t.com', role: 'admin' as const, teamIds: [] };
  const { conversationId } = ingestInbound(db, { channel: 'whatsapp', phone: '5511988880000', body: 'oi', externalId: 'in1' });
  const failing = (err: Error) => Object.assign(new MockChannel(), { sendText: async () => { throw err; } });
  const m1 = await sendMessage(db, failing(new ChannelError('Limite de envios da Meta atingido.')), user as any, conversationId, { kind: 'text', body: 'a' });
  assert.equal(m1.delivery_status, 'failed');
  assert.equal(m1.error, 'Limite de envios da Meta atingido.');
  const m2 = await sendMessage(db, failing(new Error('boom 5511988880000 Bearer xyz')), user as any, conversationId, { kind: 'text', body: 'b' });
  assert.equal(m2.error, 'Falha ao enviar a mensagem.');
});

test('produção: config inválida é recusada; config correta passa', () => {
  const ok: Config = {
    ...config, production: true, publicUrl: 'https://atendimento.exemplo.com.br', trustProxy: 1, seedAdminPassword: '',
    whatsapp: { ...config.whatsapp, mode: 'cloud', verifyToken: 'x'.repeat(32) },
  };
  assert.deepEqual(productionProblems(ok), []);
  assert.deepEqual(productionProblems({ ...ok, production: false, publicUrl: '' }), []); // dev não exige nada
  const bad = productionProblems({
    ...ok, publicUrl: 'http://x.com', trustProxy: -1, seedAdminPassword: 'curta',
    whatsapp: { ...ok.whatsapp, mode: 'mock', verifyToken: 'troque-por-um-token-longo' },
  });
  assert.equal(bad.length, 5);
  // falha fechada: NODE_ENV com typo e HOST público fora de produção
  assert.equal(productionProblems({ ...ok, production: false, nodeEnv: 'prod' }).length, 1);
  assert.equal(productionProblems({ ...ok, production: false, nodeEnv: 'development', host: '0.0.0.0' }).length, 1);
  assert.deepEqual(productionProblems({ ...ok, production: false, nodeEnv: 'development', host: '127.0.0.1' }), []);
});

test('webhook: falha ao processar item responde 500 para a Meta reenviar', async () => {
  const db = openDb(':memory:');
  const app = await buildApp({ db, channel: new MockChannel() });
  const payload = { entry: [{ changes: [{ value: { messages: [{ id: 'wamid.F', from: '5511966660000', type: 'text', text: { body: 'oi' } }] } }] }] };
  const post = () => app.inject({ method: 'POST', url: '/webhooks/whatsapp', payload });
  assert.equal((await post()).statusCode, 200);
  db.exec('DROP TABLE messages'); // simula falha do banco
  const retry = { ...payload, entry: [{ changes: [{ value: { messages: [{ id: 'wamid.G', from: '5511966660000', type: 'text', text: { body: 'oi' } }] } }] }] };
  assert.equal((await app.inject({ method: 'POST', url: '/webhooks/whatsapp', payload: retry })).statusCode, 500);
});

test('/healthz responde sem autenticação e sem dados', async () => {
  const app = await buildApp({ db: openDb(':memory:'), channel: new MockChannel() });
  const res = await app.inject({ method: 'GET', url: '/healthz' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
});

test('trust proxy: IP real vem do X-Forwarded-For só quando configurado', async () => {
  const probe = async (hops: number) => {
    const prev = config.trustProxy;
    config.trustProxy = hops;
    try {
      const app = await buildApp({ db: openDb(':memory:'), channel: new MockChannel() });
      app.get('/ip', async (req) => ({ ip: req.ip }));
      const res = await app.inject({ method: 'GET', url: '/ip', headers: { 'x-forwarded-for': '203.0.113.9' }, remoteAddress: '10.0.0.1' });
      return res.json().ip;
    } finally { config.trustProxy = prev; }
  };
  assert.equal(await probe(0), '10.0.0.1');
  assert.equal(await probe(1), '203.0.113.9');
});

test('backup: cópia consistente do banco com rotação', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cordial-bkp-'));
  try {
    const db = openDb(':memory:');
    ingestInbound(db, { channel: 'whatsapp', phone: '5511977770000', body: 'oi', externalId: 'b1' });
    for (let i = 0; i < 4; i++) backupDb(db, dir, 2, new Date(Date.UTC(2026, 0, 1, 0, 0, i)));
    const files = readdirSync(dir).sort();
    assert.deepEqual(files, ['cordial-20260101-000002.db', 'cordial-20260101-000003.db']);
    const copy = openDb(join(dir, files[1]));
    assert.equal((copy.prepare('SELECT COUNT(*) n FROM messages').get() as any).n, 1);
    copy.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('retenção: simulação não apaga; aplicar remove só resolvidas antigas e clientes órfãos', () => {
  const db = openDb(':memory:');
  const old = ingestInbound(db, { channel: 'whatsapp', phone: '5511900000001', body: 'velha', externalId: 'r1' }).conversationId;
  const recent = ingestInbound(db, { channel: 'whatsapp', phone: '5511900000002', body: 'nova', externalId: 'r2' }).conversationId;
  const open = ingestInbound(db, { channel: 'whatsapp', phone: '5511900000003', body: 'aberta', externalId: 'r3' }).conversationId;
  db.prepare("INSERT INTO customers (name, phone) VALUES ('Manual', '5511900000009')").run();
  const setResolved = (id: number, iso: string) => db.prepare("UPDATE conversations SET status='resolved', resolved_at=? WHERE id=?").run(iso, id);
  setResolved(old, '2025-01-01T00:00:00.000Z');
  setResolved(recent, '2026-06-01T00:00:00.000Z');
  const now = new Date('2026-07-01T00:00:00Z');

  assert.deepEqual(purgeResolved(db, 90, false, now), { conversations: 1, messages: 1, customers: 0, applied: false });
  assert.equal((db.prepare('SELECT COUNT(*) n FROM conversations').get() as any).n, 3);

  assert.deepEqual(purgeResolved(db, 90, true, now), { conversations: 1, messages: 1, customers: 1, applied: true });
  const left = (db.prepare('SELECT id FROM conversations ORDER BY id').all() as any[]).map((x) => x.id);
  assert.deepEqual(left, [recent, open]);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM customers WHERE phone = '5511900000009'").get() as any).n, 1);
  const log = db.prepare("SELECT detail FROM audit_log WHERE action = 'retention.purge'").get() as any;
  assert.deepEqual(JSON.parse(log.detail), { days: 90, conversations: 1, messages: 1, customers: 1 });
  assert.throws(() => purgeResolved(db, 0, true, now));
});
