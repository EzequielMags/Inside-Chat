import type { Db, Row } from './db.ts';
import { tx, audit } from './db.ts';
import { config } from './config.ts';
import { emit } from './events.ts';
import { ChannelError, type Channel, type InboundMessage, type StatusUpdate } from './channels/types.ts';
import type { SessionUser } from './auth.ts';

export class HttpError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) { super(message); this.status = status; this.code = code; }
}

// ---------- utilidades ----------

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) throw new HttpError(400, 'Telefone inválido (use DDI+DDD+número)');
  return digits;
}

const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
/** Dia da semana (0=dom..6=sáb) de um instante, no fuso configurado. */
export function localDow(date: Date, tz = config.timezone): number {
  return DOW[new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(date)];
}

/** 'YYYY-MM-DD' (dia local) -> instante ISO usando o offset configurado. */
export function localDayStart(day: string, offset = config.tzOffset): string {
  return new Date(`${day}T00:00:00${offset}`).toISOString();
}
export function localDayEnd(day: string, offset = config.tzOffset): string {
  return new Date(new Date(`${day}T00:00:00${offset}`).getTime() + 86_400_000).toISOString();
}

export function windowInfo(lastInboundAt: string | null, now = new Date()) {
  if (!lastInboundAt) return { open: false, expiresAt: null as string | null };
  const expires = new Date(new Date(lastInboundAt).getTime() + config.windowHours * 3_600_000);
  return { open: expires > now, expiresAt: expires.toISOString() };
}

export function renderTemplate(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] ?? '');
}

// ---------- permissões ----------

export function canAccess(user: SessionUser, conv: Row): boolean {
  if (user.role === 'admin') return true;
  if (conv.assignee_id === user.id) return true;
  if (conv.team_id != null && user.teamIds.includes(conv.team_id)) return true;
  return conv.assignee_id == null && conv.team_id == null;
}

/** Cláusula SQL equivalente a canAccess, para listagens. */
export function accessClause(user: SessionUser, alias = 'c'): { sql: string; params: number[] } {
  if (user.role === 'admin') return { sql: '1=1', params: [] };
  const teamPart = user.teamIds.length ? ` OR ${alias}.team_id IN (${user.teamIds.map(() => '?').join(',')})` : '';
  return {
    sql: `(${alias}.assignee_id = ? OR (${alias}.assignee_id IS NULL AND ${alias}.team_id IS NULL)${teamPart})`,
    params: [user.id, ...user.teamIds],
  };
}

export function getConversationFor(db: Db, user: SessionUser, id: number): Row {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Row | undefined;
  // 404 também para "sem acesso": não revela a existência de conversas de outras equipes.
  if (!conv || !canAccess(user, conv)) throw new HttpError(404, 'Conversa não encontrada');
  return conv;
}

// ---------- ingestão (entrada) ----------

export function ingestInbound(db: Db, msg: InboundMessage): { conversationId: number; duplicate: boolean } {
  const at = msg.timestamp ?? new Date();
  const iso = at.toISOString();
  const result = tx(db, () => {
    if (msg.externalId && db.prepare('SELECT 1 FROM messages WHERE external_id = ?').get(msg.externalId)) {
      return { conversationId: 0, duplicate: true, created: false };
    }
    const phone = normalizePhone(msg.phone);
    let customer = db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone) as Row | undefined;
    if (!customer) {
      const info = db.prepare('INSERT INTO customers (name, phone) VALUES (?,?)').run(msg.contactName?.trim() || phone, phone);
      customer = { id: Number(info.lastInsertRowid), name: msg.contactName ?? phone, phone };
    } else if (msg.contactName && customer.name === customer.phone) {
      db.prepare('UPDATE customers SET name = ? WHERE id = ?').run(msg.contactName.trim(), customer.id);
    }

    let conv = db.prepare(
      `SELECT * FROM conversations WHERE customer_id = ? AND channel = ? AND status != 'resolved' ORDER BY id DESC LIMIT 1`,
    ).get(customer.id, msg.channel) as Row | undefined;
    let created = false;
    if (!conv) {
      const info = db.prepare(
        `INSERT INTO conversations (customer_id, channel, created_at, last_message_at, last_inbound_at) VALUES (?,?,?,?,?)`,
      ).run(customer.id, msg.channel, iso, iso, iso);
      conv = { id: Number(info.lastInsertRowid) };
      created = true;
    }
    db.prepare(
      `INSERT INTO messages (conversation_id, direction, kind, body, external_id, local_dow, created_at)
       VALUES (?, 'in', 'text', ?, ?, ?, ?)`,
    ).run(conv.id, msg.body, msg.externalId, localDow(at), iso);
    db.prepare(
      `UPDATE conversations SET last_message_at = ?, last_inbound_at = ?, unread_count = unread_count + 1, last_preview = ? WHERE id = ?`,
    ).run(iso, iso, msg.body.slice(0, 140), conv.id);
    return { conversationId: conv.id as number, duplicate: false, created };
  });
  if (!result.duplicate) emit({ type: result.created ? 'conversation.created' : 'conversation.updated', conversationId: result.conversationId });
  return { conversationId: result.conversationId, duplicate: result.duplicate };
}

const RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3 };
export function applyStatus(db: Db, s: StatusUpdate) {
  const row = db.prepare('SELECT id, conversation_id, delivery_status FROM messages WHERE external_id = ?').get(s.externalId) as Row | undefined;
  if (!row) return;
  // Webhooks chegam fora de ordem: nunca "rebaixa" o status (read -> delivered). 'failed' sempre vence.
  if (s.status !== 'failed' && (RANK[s.status] ?? 0) <= (RANK[row.delivery_status] ?? 0)) return;
  db.prepare('UPDATE messages SET delivery_status = ?, error = ? WHERE id = ?').run(s.status, s.error ?? null, row.id);
  emit({ type: 'conversation.updated', conversationId: row.conversation_id });
}

// ---------- envio (saída) ----------

export interface SendInput {
  kind: 'text' | 'template' | 'note';
  body?: string;
  templateId?: number;
  params?: string[];
}

/** Só mensagens já traduzidas (ChannelError) chegam ao histórico; qualquer outro erro vira texto genérico. */
function sendErrorText(e: unknown): string {
  return e instanceof ChannelError ? e.message : 'Falha ao enviar a mensagem.';
}

export async function sendMessage(db: Db, channel: Channel, user: SessionUser, conversationId: number, input: SendInput): Promise<Row> {
  const conv = getConversationFor(db, user, conversationId);
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(conv.customer_id) as Row;
  const iso = new Date().toISOString();
  const dow = localDow(new Date());

  if (input.kind === 'note') {
    const body = (input.body ?? '').trim();
    if (!body) throw new HttpError(400, 'Nota vazia');
    const info = db.prepare(
      `INSERT INTO messages (conversation_id, direction, kind, body, sender_user_id, local_dow, created_at) VALUES (?, 'out', 'note', ?, ?, ?, ?)`,
    ).run(conv.id, body, user.id, dow, iso);
    emit({ type: 'conversation.updated', conversationId: conv.id });
    return db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid) as Row;
  }

  if (conv.status === 'resolved') throw new HttpError(409, 'Conversa resolvida: reabra para responder', 'resolved');

  const win = windowInfo(conv.last_inbound_at);
  let body: string;
  let templateName: string | null = null;
  let externalId: string | null = null;
  let error: string | null = null;

  if (input.kind === 'text') {
    body = (input.body ?? '').trim();
    if (!body) throw new HttpError(400, 'Mensagem vazia');
    if (body.length > 4096) throw new HttpError(400, 'Mensagem longa demais (máx. 4096)');
    if (!win.open) {
      throw new HttpError(409, 'Janela de 24 h encerrada: envie um template aprovado.', 'window_closed');
    }
    try { externalId = (await channel.sendText(customer.phone, body)).externalId; }
    catch (e) { error = sendErrorText(e); }
  } else {
    const tpl = db.prepare('SELECT * FROM templates WHERE id = ? AND active = 1').get(input.templateId ?? -1) as Row | undefined;
    if (!tpl) throw new HttpError(400, 'Template não encontrado');
    const params = input.params ?? [];
    const needed = new Set([...tpl.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1])).size;
    if (params.length < needed || params.some((p) => !p.trim())) throw new HttpError(400, `Preencha os ${needed} parâmetro(s) do template`);
    body = renderTemplate(tpl.body, params);
    templateName = tpl.name;
    try { externalId = (await channel.sendTemplate(customer.phone, { name: tpl.name, language: tpl.language }, params)).externalId; }
    catch (e) { error = sendErrorText(e); }
  }

  const row = tx(db, () => {
    const info = db.prepare(
      `INSERT INTO messages (conversation_id, direction, kind, body, template_name, sender_user_id, external_id, delivery_status, error, local_dow, created_at)
       VALUES (?, 'out', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(conv.id, input.kind, body, templateName, user.id, externalId, error ? 'failed' : 'sent', error, dow, iso);
    if (!error) {
      // Primeira resposta humana: marca SLA e, se ninguém assumiu, o respondente assume.
      db.prepare(
        `UPDATE conversations SET last_message_at = ?, last_preview = ?, unread_count = 0,
           first_response_at = COALESCE(first_response_at, ?),
           assignee_id = COALESCE(assignee_id, ?),
           status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END
         WHERE id = ?`,
      ).run(iso, `Você: ${body}`.slice(0, 140), iso, user.id, conv.id);
    }
    return db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid) as Row;
  });
  emit({ type: 'conversation.updated', conversationId: conv.id });
  return row;
}

// ---------- atualização de conversa ----------

export interface ConversationPatch {
  status?: 'open' | 'in_progress' | 'resolved';
  assigneeId?: number | null;
  teamId?: number | null;
}

export function updateConversation(db: Db, user: SessionUser, id: number, patch: ConversationPatch): Row {
  const conv = getConversationFor(db, user, id);
  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (patch.assigneeId !== undefined) {
    if (patch.assigneeId !== null && !db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(patch.assigneeId)) {
      throw new HttpError(400, 'Atendente inválido');
    }
    sets.push('assignee_id = ?'); params.push(patch.assigneeId);
  }
  if (patch.teamId !== undefined) {
    if (patch.teamId !== null && !db.prepare('SELECT 1 FROM teams WHERE id = ?').get(patch.teamId)) throw new HttpError(400, 'Equipe inválida');
    sets.push('team_id = ?'); params.push(patch.teamId);
  }
  if (patch.status !== undefined) {
    sets.push('status = ?'); params.push(patch.status);
    sets.push('resolved_at = ?'); params.push(patch.status === 'resolved' ? new Date().toISOString() : null);
  }
  if (sets.length) {
    db.prepare(`UPDATE conversations SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
    audit(db, user.id, 'conversation.update', 'conversation', id, { from: { status: conv.status, assignee: conv.assignee_id, team: conv.team_id }, patch });
    emit({ type: 'conversation.updated', conversationId: id });
  }
  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Row;
}

// ---------- listagem com filtros ----------

export interface ListFilters {
  status?: string;
  assignee?: string; // id | 'me' | 'none'
  teamId?: number;
  from?: string;     // YYYY-MM-DD (dia local)
  to?: string;
  weekend?: 'sat' | 'sun' | 'both';
  q?: string;
  limit?: number;
  offset?: number;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export function listConversations(db: Db, user: SessionUser, f: ListFilters): Row[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  const access = accessClause(user);
  where.push(access.sql); params.push(...access.params);

  if (f.status) { where.push('c.status = ?'); params.push(f.status); }
  if (f.assignee === 'me') { where.push('c.assignee_id = ?'); params.push(user.id); }
  else if (f.assignee === 'none') where.push('c.assignee_id IS NULL');
  else if (f.assignee) { where.push('c.assignee_id = ?'); params.push(Number(f.assignee)); }
  if (f.teamId) { where.push('c.team_id = ?'); params.push(f.teamId); }
  if (f.from) { where.push('c.last_message_at >= ?'); params.push(localDayStart(f.from)); }
  if (f.to) { where.push('c.last_message_at < ?'); params.push(localDayEnd(f.to)); }
  if (f.weekend) {
    const days = f.weekend === 'sat' ? [6] : f.weekend === 'sun' ? [0] : [6, 0];
    where.push(`EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.direction = 'in' AND m.local_dow IN (${days.join(',')}))`);
  }
  if (f.q) {
    const like = `%${escapeLike(f.q)}%`;
    where.push(`(cu.name LIKE ? ESCAPE '\\' OR cu.phone LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.kind != 'note' AND m.body LIKE ? ESCAPE '\\'))`);
    params.push(like, like, like);
  }

  return db.prepare(
    `SELECT c.*, cu.name AS customer_name, cu.phone AS customer_phone, u.name AS assignee_name, t.name AS team_name
     FROM conversations c
     JOIN customers cu ON cu.id = c.customer_id
     LEFT JOIN users u ON u.id = c.assignee_id
     LEFT JOIN teams t ON t.id = c.team_id
     WHERE ${where.join(' AND ')}
     ORDER BY c.last_message_at DESC
     LIMIT ? OFFSET ?`,
  ).all(...params, Math.min(f.limit ?? 50, 200), f.offset ?? 0) as Row[];
}

// ---------- indicadores ----------

export function metrics(db: Db, user: SessionUser, f: { from?: string; to?: string; weekend?: 'sat' | 'sun' | 'both' }) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  const access = accessClause(user);
  where.push(access.sql); params.push(...access.params);
  if (f.from) { where.push('c.created_at >= ?'); params.push(localDayStart(f.from)); }
  if (f.to) { where.push('c.created_at < ?'); params.push(localDayEnd(f.to)); }
  if (f.weekend) {
    const days = f.weekend === 'sat' ? [6] : f.weekend === 'sun' ? [0] : [6, 0];
    where.push(`EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.direction = 'in' AND m.local_dow IN (${days.join(',')}))`);
  }
  const rows = db.prepare(
    `SELECT c.id, c.status, c.assignee_id, c.created_at, c.first_response_at, c.resolved_at, u.name AS assignee_name
     FROM conversations c LEFT JOIN users u ON u.id = c.assignee_id WHERE ${where.join(' AND ')}`,
  ).all(...params) as Row[];

  const byStatus: Record<string, number> = { open: 0, in_progress: 0, resolved: 0 };
  const perDay = new Map<string, number>();
  const perAgent = new Map<string, number>();
  const frt: number[] = [];
  const res: number[] = [];
  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone });
  for (const r of rows) {
    byStatus[r.status]++;
    const day = dayFmt.format(new Date(r.created_at));
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
    const agent = r.assignee_name ?? 'Sem responsável';
    perAgent.set(agent, (perAgent.get(agent) ?? 0) + 1);
    if (r.first_response_at) frt.push((Date.parse(r.first_response_at) - Date.parse(r.created_at)) / 1000);
    if (r.resolved_at) res.push((Date.parse(r.resolved_at) - Date.parse(r.created_at)) / 1000);
  }
  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
  const median = (a: number[]) => {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y);
    const m = s.length >> 1;
    return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
  };
  return {
    total: rows.length,
    byStatus,
    firstResponse: { avgSeconds: avg(frt), medianSeconds: median(frt), samples: frt.length },
    resolution: { avgSeconds: avg(res), medianSeconds: median(res), samples: res.length },
    perDay: [...perDay.entries()].sort().map(([day, count]) => ({ day, count })),
    perAgent: [...perAgent.entries()].map(([agent, count]) => ({ agent, count })).sort((a, b) => b.count - a.count),
  };
}
