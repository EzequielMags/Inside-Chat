import Fastify, { type FastifyRequest, type FastifyServerOptions } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { z, ZodError } from 'zod';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import type { Db, Row } from './db.ts';
import { audit, tx } from './db.ts';
import { config } from './config.ts';
import {
  authenticate, createSession, destroySession, hashPassword, loadUserByToken, LoginLimiter, type SessionUser,
} from './auth.ts';
import {
  HttpError, applyStatus, getConversationFor, ingestInbound, listConversations, metrics, normalizePhone,
  sendMessage, updateConversation, windowInfo, accessClause,
} from './domain.ts';
import { bus, type AppEvent } from './events.ts';
import type { Channel } from './channels/types.ts';
import { parseWebhook, verifySignature } from './channels/whatsapp.ts';
import { makeMailer, type Mailer } from './mailer.ts';
import { createSignup, decideByToken, decideSignup, describeApproval, describeVerification, reopenSignup, resendApproval, verifyEmail } from './signup.ts';

declare module 'fastify' {
  interface FastifyRequest { user?: SessionUser; rawBody?: Buffer }
}

const COOKIE = 'cordial_sid';
const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const id = z.coerce.number().int().positive();
const email = z.string().trim().toLowerCase().email().max(200);
const password = z.string().min(8, 'Senha com no mínimo 8 caracteres').max(200);

export interface AppDeps { db: Db; channel: Channel; mailer?: Mailer; logger?: boolean }

const PUBLIC_API = ['/api/auth/login', '/api/auth/signup', '/api/auth/verify', '/api/auth/approval', '/api/auth/approval/resend'];

export async function buildApp({ db, channel, mailer = makeMailer(config), logger = false }: AppDeps) {
  const wa = config.whatsapp;
  if (wa.mode === 'cloud' && (!wa.appSecret || !wa.verifyToken || !wa.accessToken || !wa.phoneNumberId)) {
    throw new Error('WA_MODE=cloud exige WA_APP_SECRET, WA_VERIFY_TOKEN, WA_ACCESS_TOKEN e WA_PHONE_NUMBER_ID');
  }

  const serverOptions: FastifyServerOptions = {
    logger: logger ? {
      redact: ['req.headers.cookie', 'req.headers.authorization'],
      // Sem query string no log: o link de aprovação leva o token em ?t=.
      serializers: { req: (req: any) => ({ method: req.method, url: String(req.url).split('?')[0], hostname: req.hostname }) },
    } : false,
    bodyLimit: 1_000_000,
    // Confia só nos N primeiros saltos (N = TRUST_PROXY); atrás deles, req.ip é o do cliente (limitadores).
    trustProxy: (_addr: string, hop: number) => hop < config.trustProxy,
  };
  const app = Fastify(serverOptions);
  await app.register(fastifyCookie);
  const limiter = new LoginLimiter();
  const signupLimiter = new LoginLimiter(5, 60 * 60_000);     // 5 cadastros por IP por hora
  const approvalLimiter = new LoginLimiter(30, 15 * 60_000);  // consultas ao link de aprovação por IP
  const resendLimiter = new LoginLimiter(5, 60 * 60_000);     // reemissões do link de aprovação por IP (cota própria)
  const verifyLimiter = new LoginLimiter(30, 15 * 60_000);    // idem para o link de confirmação (contador separado)

  // JSON com corpo bruto preservado (necessário para validar a assinatura do webhook).
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body: Buffer, done) => {
    req.rawBody = body;
    if (!body.length) return done(null, {});
    try { done(null, JSON.parse(body.toString('utf8'))); }
    catch { done(new HttpError(400, 'JSON inválido'), undefined); }
  });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (config.production) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (_req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
  });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message, code: err.code });
    if (err instanceof ZodError) return reply.status(400).send({ error: err.issues[0]?.message ?? 'Dados inválidos', code: 'validation' });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.message });
    app.log.error(err);
    return reply.status(500).send({ error: 'Erro interno' });
  });

  // Auth + CSRF para /api (exceto login).
  app.addHook('preHandler', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-requested-with'] !== 'cordial') {
      throw new HttpError(403, 'Requisição inválida');
    }
    if (PUBLIC_API.some((p) => req.url === p || req.url.startsWith(`${p}?`))) return;
    const user = loadUserByToken(db, req.cookies[COOKIE]);
    if (!user) throw new HttpError(401, 'Não autenticado');
    req.user = user;
  });

  const me = (req: FastifyRequest) => req.user!;
  const admin = (req: FastifyRequest) => {
    if (me(req).role !== 'admin') throw new HttpError(403, 'Apenas administradores');
    return me(req);
  };

  // ---------- auth ----------
  app.post('/api/auth/login', async (req, reply) => {
    const body = z.object({ email: z.string().trim().toLowerCase(), password: z.string().max(200) }).parse(req.body);
    const key = `${req.ip}|${body.email}`;
    if (limiter.blocked(key)) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.');
    const user = authenticate(db, body.email, body.password);
    if (!user) { limiter.fail(key); throw new HttpError(401, 'E-mail ou senha incorretos'); }
    // A senha conferiu, então já não há risco de revelar a existência da conta.
    if (user.status === 'pending') throw new HttpError(403, 'Seu cadastro ainda aguarda a aprovação do administrador.', 'pending');
    if (user.status === 'rejected') throw new HttpError(403, 'Seu cadastro não foi aprovado.', 'rejected');
    if (!user.active) { limiter.fail(key); throw new HttpError(401, 'E-mail ou senha incorretos'); }
    limiter.clear(key);
    const { token, expiresAt } = createSession(db, user.id);
    audit(db, user.id, 'auth.login', 'user', user.id);
    reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.production, path: '/', expires: expiresAt });
    return { ok: true };
  });

  // ---------- cadastro com aprovação ----------
  app.post('/api/auth/signup', async (req, reply) => {
    const b = z.object({
      name: z.string().trim().min(2, 'Informe seu nome').max(120),
      email,
    }).strict().parse(req.body);
    if (signupLimiter.blocked(req.ip)) throw new HttpError(429, 'Muitos cadastros em pouco tempo. Tente mais tarde.');
    signupLimiter.fail(req.ip);
    await createSignup(db, mailer, b, (m) => app.log.error(m));
    return reply.status(202).send({ ok: true }); // mesma resposta para e-mail novo ou já existente
  });

  app.get('/api/auth/verify', async (req) => {
    if (verifyLimiter.blocked(req.ip)) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.');
    verifyLimiter.fail(req.ip);
    const { t } = z.object({ t: z.string().min(20).max(100) }).parse(req.query);
    return describeVerification(db, t);
  });

  app.post('/api/auth/verify', async (req) => {
    if (verifyLimiter.blocked(req.ip)) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.');
    verifyLimiter.fail(req.ip);
    const b = z.object({ token: z.string().min(20).max(100), password }).strict().parse(req.body);
    return { ok: true, ...verifyEmail(db, mailer, b.token, b.password, (m) => app.log.error(m)) };
  });

  app.get('/api/auth/approval', async (req) => {
    if (approvalLimiter.blocked(req.ip)) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.');
    approvalLimiter.fail(req.ip);
    const { t } = z.object({ t: z.string().min(20).max(100) }).parse(req.query);
    return describeApproval(db, t);
  });

  app.post('/api/auth/approval', async (req) => {
    if (approvalLimiter.blocked(req.ip)) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.');
    approvalLimiter.fail(req.ip);
    const b = z.object({ token: z.string().min(20).max(100), decision: z.enum(['approve', 'reject']) }).strict().parse(req.body);
    const who = await decideByToken(db, mailer, b.token, b.decision);
    return { ok: true, decision: b.decision, ...who };
  });

  app.post('/api/auth/approval/resend', async (req, reply) => {
    if (resendLimiter.blocked(req.ip)) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.');
    resendLimiter.fail(req.ip);
    const b = z.object({ token: z.string().min(20).max(100) }).strict().parse(req.body);
    resendApproval(db, mailer, b.token, (m) => app.log.error(m));
    return reply.status(202).send({ ok: true });
  });

  app.post('/api/users/:id/approval', async (req) => {
    const admin_ = admin(req);
    const b = z.object({ decision: z.enum(['approve', 'reject']) }).strict().parse(req.body);
    await decideSignup(db, mailer, id.parse((req.params as any).id), b.decision, admin_.id);
    return { ok: true };
  });

  app.post('/api/users/:id/reopen', async (req) => {
    const admin_ = admin(req);
    return { ok: true, ...reopenSignup(db, mailer, id.parse((req.params as any).id), admin_.id) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[COOKIE];
    if (token) destroySession(db, token);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', async (req) => ({ ...me(req), timezone: config.timezone, waMode: wa.mode }));

  app.post('/api/me/password', async (req) => {
    const user = me(req);
    const body = z.object({ current: z.string(), next: password }).parse(req.body);
    if (!authenticate(db, user.email, body.current)) throw new HttpError(400, 'Senha atual incorreta');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(body.next), user.id);
    // Encerra as outras sessões.
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    audit(db, user.id, 'user.password_change', 'user', user.id);
    return { ok: true, relogin: true };
  });

  // ---------- tempo real (SSE) ----------
  app.get('/api/events', (req, reply) => {
    const user = me(req);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(': conectado\n\n');
    const onEvent = (e: AppEvent) => {
      // Só avisa quem pode ver a conversa; o conteúdo vem depois pela API autenticada.
      const conv = db.prepare('SELECT assignee_id, team_id FROM conversations WHERE id = ?').get(e.conversationId) as Row | undefined;
      if (!conv) return;
      const visible = user.role === 'admin' || conv.assignee_id === user.id || (conv.team_id != null && user.teamIds.includes(conv.team_id))
        || (conv.assignee_id == null && conv.team_id == null);
      if (visible) res.write(`data: ${JSON.stringify(e)}\n\n`);
    };
    bus.on('event', onEvent);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.raw.on('close', () => { clearInterval(ping); bus.off('event', onEvent); });
  });

  // ---------- conversas ----------
  const listQuery = z.object({
    status: z.enum(['open', 'in_progress', 'resolved']).optional(),
    assignee: z.string().optional(),
    teamId: id.optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    weekend: z.enum(['sat', 'sun', 'both']).optional(),
    q: z.string().trim().max(100).optional(),
    limit: id.optional(),
    offset: z.coerce.number().int().min(0).optional(),
  });

  app.get('/api/conversations', async (req) => listConversations(db, me(req), listQuery.parse(req.query)));

  app.post('/api/conversations', async (req) => {
    // Inicia contato ativo: cria cliente/conversa sem mensagem do cliente (só templates serão aceitos).
    const body = z.object({ phone: z.string(), name: z.string().trim().max(120).optional() }).parse(req.body);
    const phone = normalizePhone(body.phone);
    const now = new Date().toISOString();
    const conversationId = tx(db, () => {
      let c = db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone) as Row | undefined;
      if (!c) {
        const info = db.prepare('INSERT INTO customers (name, phone) VALUES (?,?)').run(body.name || phone, phone);
        c = { id: Number(info.lastInsertRowid) };
      }
      const open = db.prepare(`SELECT id FROM conversations WHERE customer_id = ? AND status != 'resolved' ORDER BY id DESC LIMIT 1`).get(c.id) as Row | undefined;
      if (open) return open.id as number;
      const info = db.prepare(
        `INSERT INTO conversations (customer_id, created_at, last_message_at, assignee_id, status) VALUES (?,?,?,?, 'in_progress')`,
      ).run(c.id, now, now, me(req).id);
      return Number(info.lastInsertRowid);
    });
    return { id: conversationId };
  });

  app.get('/api/conversations/:id', async (req) => {
    const user = me(req);
    const conv = getConversationFor(db, user, id.parse((req.params as any).id));
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(conv.customer_id) as Row;
    const messages = db.prepare(
      `SELECT m.id, m.direction, m.kind, m.body, m.template_name, m.delivery_status, m.error, m.created_at, m.sender_user_id, u.name AS sender_name
       FROM messages m LEFT JOIN users u ON u.id = m.sender_user_id WHERE m.conversation_id = ? ORDER BY m.id LIMIT 1000`,
    ).all(conv.id);
    return { conversation: conv, customer, messages, window: windowInfo(conv.last_inbound_at) };
  });

  app.post('/api/conversations/:id/read', async (req) => {
    const conv = getConversationFor(db, me(req), id.parse((req.params as any).id));
    db.prepare('UPDATE conversations SET unread_count = 0 WHERE id = ?').run(conv.id);
    return { ok: true };
  });

  app.post('/api/conversations/:id/messages', async (req, reply) => {
    const body = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('text'), body: z.string() }),
      z.object({ kind: z.literal('note'), body: z.string().max(4096) }),
      z.object({ kind: z.literal('template'), templateId: id, params: z.array(z.string().max(500)).max(20).default([]) }),
    ]).parse(req.body);
    const msg = await sendMessage(db, channel, me(req), id.parse((req.params as any).id), body);
    return reply.status(201).send(msg);
  });

  app.patch('/api/conversations/:id', async (req) => {
    const patch = z.object({
      status: z.enum(['open', 'in_progress', 'resolved']).optional(),
      assigneeId: id.nullable().optional(),
      teamId: id.nullable().optional(),
    }).parse(req.body);
    return updateConversation(db, me(req), id.parse((req.params as any).id), patch);
  });

  // ---------- clientes ----------
  app.get('/api/customers', async (req) => {
    const { q } = z.object({ q: z.string().trim().max(100).optional() }).parse(req.query);
    const like = `%${(q ?? '').replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return db.prepare(
      `SELECT cu.*, (SELECT COUNT(*) FROM conversations c WHERE c.customer_id = cu.id) AS conversations
       FROM customers cu WHERE cu.name LIKE ? ESCAPE '\\' OR cu.phone LIKE ? ESCAPE '\\' ORDER BY cu.name LIMIT 100`,
    ).all(like, like);
  });

  app.get('/api/customers/:id', async (req) => {
    const user = me(req);
    const cid = id.parse((req.params as any).id);
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(cid);
    if (!customer) throw new HttpError(404, 'Cliente não encontrado');
    const access = accessClause(user);
    const conversations = db.prepare(
      `SELECT c.id, c.status, c.created_at, c.last_message_at, c.last_preview, u.name AS assignee_name
       FROM conversations c LEFT JOIN users u ON u.id = c.assignee_id
       WHERE c.customer_id = ? AND ${access.sql} ORDER BY c.id DESC`,
    ).all(cid, ...access.params);
    return { customer, conversations };
  });

  app.patch('/api/customers/:id', async (req) => {
    const body = z.object({ name: z.string().trim().min(1).max(120).optional(), notes: z.string().max(4000).optional() }).parse(req.body);
    const cid = id.parse((req.params as any).id);
    if (!db.prepare('SELECT 1 FROM customers WHERE id = ?').get(cid)) throw new HttpError(404, 'Cliente não encontrado');
    db.prepare('UPDATE customers SET name = COALESCE(?, name), notes = COALESCE(?, notes) WHERE id = ?').run(body.name ?? null, body.notes ?? null, cid);
    audit(db, me(req).id, 'customer.update', 'customer', cid);
    return db.prepare('SELECT * FROM customers WHERE id = ?').get(cid);
  });

  // ---------- usuários e equipes ----------
  app.get('/api/users', async (req) => {
    const isAdmin = me(req).role === 'admin';
    const rows = db.prepare('SELECT id, name, email, role, active, status, email_verified_at IS NOT NULL AS email_verified FROM users ORDER BY name').all() as Row[];
    const members = db.prepare('SELECT team_id, user_id FROM team_members').all() as Row[];
    return rows
      .filter((u) => isAdmin || u.active)
      .map((u) => ({ ...u, email: isAdmin ? u.email : undefined, teamIds: members.filter((m) => m.user_id === u.id).map((m) => m.team_id) }));
  });

  const setTeams = (userId: number, teamIds: number[]) => {
    db.prepare('DELETE FROM team_members WHERE user_id = ?').run(userId);
    for (const t of teamIds) {
      if (!db.prepare('SELECT 1 FROM teams WHERE id = ?').get(t)) throw new HttpError(400, 'Equipe inválida');
      db.prepare('INSERT OR IGNORE INTO team_members (team_id, user_id) VALUES (?,?)').run(t, userId);
    }
  };

  app.post('/api/users', async (req, reply) => {
    const admin_ = admin(req);
    const b = z.object({
      name: z.string().trim().min(1).max(120), email, password,
      role: z.enum(['admin', 'agent']), teamIds: z.array(id).default([]),
    }).parse(req.body);
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(b.email)) throw new HttpError(409, 'E-mail já cadastrado');
    const userId = tx(db, () => {
      const info = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)').run(b.name, b.email, hashPassword(b.password), b.role);
      setTeams(Number(info.lastInsertRowid), b.teamIds);
      return Number(info.lastInsertRowid);
    });
    audit(db, admin_.id, 'user.create', 'user', userId, { role: b.role });
    return reply.status(201).send({ id: userId });
  });

  app.patch('/api/users/:id', async (req) => {
    const admin_ = admin(req);
    const uid = id.parse((req.params as any).id);
    const b = z.object({
      name: z.string().trim().min(1).max(120).optional(), role: z.enum(['admin', 'agent']).optional(),
      active: z.boolean().optional(), password: password.optional(), teamIds: z.array(id).optional(),
    }).parse(req.body);
    const target = db.prepare('SELECT status FROM users WHERE id = ?').get(uid) as Row | undefined;
    if (!target) throw new HttpError(404, 'Usuário não encontrado');
    if (target.status !== 'approved') throw new HttpError(400, 'Cadastro não aprovado: use Aprovar ou Recusar.');
    if (uid === admin_.id && (b.active === false || b.role === 'agent')) throw new HttpError(400, 'Você não pode remover seu próprio acesso de administrador');
    tx(db, () => {
      db.prepare('UPDATE users SET name = COALESCE(?, name), role = COALESCE(?, role), active = COALESCE(?, active) WHERE id = ?')
        .run(b.name ?? null, b.role ?? null, b.active === undefined ? null : Number(b.active), uid);
      if (b.password) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(b.password), uid);
      if (b.teamIds) setTeams(uid, b.teamIds);
      // Desativação, troca de senha ou de perfil derrubam as sessões abertas.
      if (b.active === false || b.password || b.role) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(uid);
    });
    audit(db, admin_.id, 'user.update', 'user', uid, { ...b, password: b.password ? '***' : undefined });
    return { ok: true };
  });

  app.get('/api/teams', async () => {
    const teams = db.prepare('SELECT * FROM teams ORDER BY name').all() as Row[];
    const members = db.prepare('SELECT team_id, user_id FROM team_members').all() as Row[];
    return teams.map((t) => ({ ...t, memberIds: members.filter((m) => m.team_id === t.id).map((m) => m.user_id) }));
  });

  app.post('/api/teams', async (req, reply) => {
    const admin_ = admin(req);
    const b = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
    if (db.prepare('SELECT 1 FROM teams WHERE name = ?').get(b.name)) throw new HttpError(409, 'Equipe já existe');
    const info = db.prepare('INSERT INTO teams (name) VALUES (?)').run(b.name);
    audit(db, admin_.id, 'team.create', 'team', Number(info.lastInsertRowid));
    return reply.status(201).send({ id: Number(info.lastInsertRowid) });
  });

  app.delete('/api/teams/:id', async (req) => {
    const admin_ = admin(req);
    const tid = id.parse((req.params as any).id);
    tx(db, () => {
      db.prepare('UPDATE conversations SET team_id = NULL WHERE team_id = ?').run(tid);
      db.prepare('DELETE FROM teams WHERE id = ?').run(tid);
    });
    audit(db, admin_.id, 'team.delete', 'team', tid);
    return { ok: true };
  });

  // ---------- templates ----------
  app.get('/api/templates', async (req) => {
    const all = me(req).role === 'admin';
    return db.prepare(`SELECT * FROM templates ${all ? '' : 'WHERE active = 1'} ORDER BY name`).all();
  });

  const tplBody = z.object({
    name: z.string().trim().regex(/^[a-z0-9_]{1,512}$/, 'Nome: minúsculas, números e _ (igual ao cadastrado na Meta)'),
    language: z.string().trim().min(2).max(10).default('pt_BR'),
    category: z.enum(['UTILITY', 'MARKETING', 'AUTHENTICATION']).default('UTILITY'),
    body: z.string().trim().min(1).max(1024),
  });

  app.post('/api/templates', async (req, reply) => {
    const admin_ = admin(req);
    const b = tplBody.parse(req.body);
    try {
      const info = db.prepare('INSERT INTO templates (name, language, category, body) VALUES (?,?,?,?)').run(b.name, b.language, b.category, b.body);
      audit(db, admin_.id, 'template.create', 'template', Number(info.lastInsertRowid));
      return reply.status(201).send({ id: Number(info.lastInsertRowid) });
    } catch (e: any) {
      if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'Template já cadastrado neste idioma');
      throw e;
    }
  });

  app.patch('/api/templates/:id', async (req) => {
    const admin_ = admin(req);
    const tid = id.parse((req.params as any).id);
    const b = z.object({ active: z.boolean().optional(), body: z.string().trim().min(1).max(1024).optional() }).parse(req.body);
    db.prepare('UPDATE templates SET active = COALESCE(?, active), body = COALESCE(?, body) WHERE id = ?')
      .run(b.active === undefined ? null : Number(b.active), b.body ?? null, tid);
    audit(db, admin_.id, 'template.update', 'template', tid);
    return { ok: true };
  });

  // ---------- indicadores e auditoria ----------
  app.get('/api/metrics', async (req) => {
    const q = z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      weekend: z.enum(['sat', 'sun', 'both']).optional(),
    }).parse(req.query);
    return metrics(db, me(req), q);
  });

  app.get('/api/audit', async (req) => {
    admin(req);
    return db.prepare(
      `SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 200`,
    ).all();
  });

  // ---------- webhook WhatsApp ----------
  app.get('/webhooks/whatsapp', async (req, reply) => {
    const q = req.query as Record<string, string>;
    const token = Buffer.from(q['hub.verify_token'] ?? '');
    const expected = Buffer.from(wa.verifyToken);
    const ok = q['hub.mode'] === 'subscribe' && expected.length > 0 && token.length === expected.length && timingSafeEqual(token, expected);
    if (!ok) return reply.status(403).send('forbidden');
    return reply.type('text/plain').send(q['hub.challenge'] ?? '');
  });

  app.post('/webhooks/whatsapp', async (req, reply) => {
    // Em "cloud" a assinatura é sempre obrigatória. Em "mock" só é exigida se houver app secret.
    if (wa.mode === 'cloud' || wa.appSecret) {
      if (!verifySignature(req.rawBody ?? Buffer.alloc(0), req.headers['x-hub-signature-256'] as string | undefined, wa.appSecret)) {
        return reply.status(401).send({ error: 'assinatura inválida' });
      }
    }
    const { messages, statuses } = parseWebhook(req.body);
    for (const m of messages) {
      try { ingestInbound(db, m); } catch (e) { app.log.error(e); }
    }
    for (const s of statuses) applyStatus(db, s);
    return reply.status(200).send({ ok: true }); // a Meta reenvia em caso de erro; responda sempre 200 após validar
  });

  // ---------- simulador (apenas modo mock) ----------
  if (wa.mode === 'mock') {
    app.post('/api/dev/simulate-inbound', async (req) => {
      admin(req);
      const b = z.object({ phone: z.string(), name: z.string().max(120).optional(), text: z.string().min(1).max(4096) }).parse(req.body);
      return ingestInbound(db, {
        channel: 'whatsapp', phone: b.phone, contactName: b.name, body: b.text, externalId: `sim.${crypto.randomUUID()}`,
      });
    });
  }

  // ---------- frontend estático ----------
  await app.register(fastifyStatic, { root: publicDir, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/webhooks/')) return reply.status(404).send({ error: 'Não encontrado' });
    return reply.sendFile('index.html');
  });

  return app;
}
