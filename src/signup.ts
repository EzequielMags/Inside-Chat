import { randomBytes, createHash } from 'node:crypto';
import type { Db, Row } from './db.ts';
import { audit, tx } from './db.ts';
import { config } from './config.ts';
import { hashPassword } from './auth.ts';
import { HttpError } from './domain.ts';
import type { Mailer } from './mailer.ts';

/*
 * Fluxo: cadastro (pending) -> e-mail de confirmação ao solicitante (token "verify")
 *        -> solicitante confirma -> e-mail ao aprovador (token "approval") -> aprova/recusa.
 */

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const oneLine = (s: string) => s.replace(/[\r\n\t]+/g, ' ').trim();
type Kind = 'verify' | 'approval';

// A senha NÃO é pedida aqui: quem controla o e-mail a define ao confirmá-lo (evita pré-sequestro de conta).
export interface SignupInput { name: string; email: string }

const MAX_VERIFY_EMAILS = 3; // teto de e-mails de confirmação por cadastro
const MAX_APPROVAL_EMAILS = 5; // teto de e-mails de aprovação por cadastro

/** Invalida tokens anteriores do mesmo tipo e emite um novo. Chamar dentro de tx. */
function issueToken(db: Db, userId: number, kind: Kind): string {
  db.prepare('UPDATE signup_approvals SET used_at = ? WHERE user_id = ? AND kind = ? AND used_at IS NULL').run(new Date().toISOString(), userId, kind);
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.approvalTtlHours * 3_600_000).toISOString();
  db.prepare('INSERT INTO signup_approvals (user_id, token_hash, expires_at, kind) VALUES (?,?,?,?)').run(userId, sha256(token), expires, kind);
  return token;
}

/**
 * Registra um cadastro pendente e envia o e-mail de confirmação ao solicitante.
 * Resposta idêntica para e-mail novo, repetido ou já existente: não revela quem tem conta.
 */
export async function createSignup(db: Db, mailer: Mailer, input: SignupInput, log: (msg: string) => void = () => {}): Promise<void> {
  const email = input.email.toLowerCase();
  // Senha provisória aleatória e inutilizável; o hash é sempre calculado para o tempo não denunciar contas existentes.
  const placeholderHash = hashPassword(randomBytes(24).toString('hex'));
  const issued = tx(db, () => {
    // Cadastros nunca confirmados não ficam para sempre (e liberam o e-mail).
    db.prepare(`DELETE FROM users WHERE status = 'pending' AND email_verified_at IS NULL AND created_at < ?`)
      .run(new Date(Date.now() - config.approvalTtlHours * 3_600_000).toISOString());
    const existing = db.prepare('SELECT id, name, status, email_verified_at FROM users WHERE email = ?').get(email) as Row | undefined;
    if (existing && (existing.status !== 'pending' || existing.email_verified_at)) return null;
    if (existing) {
      const sent = (db.prepare(`SELECT COUNT(*) AS n FROM signup_approvals WHERE user_id = ? AND kind = 'verify'`).get(existing.id) as Row).n as number;
      if (sent >= MAX_VERIFY_EMAILS) return null;
      // Reenvio: no máximo um e-mail novo a cada 5 min por cadastro (evita spam e invalidar o link já enviado).
      const recent = db.prepare(`SELECT 1 FROM signup_approvals WHERE user_id = ? AND kind = 'verify' AND used_at IS NULL AND created_at > ?`)
        .get(existing.id, new Date(Date.now() - 5 * 60_000).toISOString());
      if (recent) return null;
    }
    let userId = existing?.id as number | undefined;
    if (!userId) {
      // Perfil sempre "agent" e inativo até a aprovação: o cadastro público nunca concede privilégio.
      const info = db.prepare(`INSERT INTO users (name, email, password_hash, role, active, status) VALUES (?,?,?, 'agent', 0, 'pending')`)
        .run(oneLine(input.name), email, placeholderHash);
      userId = Number(info.lastInsertRowid);
      audit(db, null, 'signup.request', 'user', userId);
    } else {
      db.prepare('UPDATE users SET name = ? WHERE id = ?').run(oneLine(input.name), userId); // vale o pedido mais recente
    }
    return { token: issueToken(db, userId, 'verify'), name: oneLine(input.name) };
  });
  if (!issued) return;
  // Não aguarda o envio: o tempo de resposta não pode denunciar se o e-mail já tinha conta.
  mailer.send({
    to: email,
    subject: 'Inside Chat: confirme seu e-mail',
    text: `Olá, ${issued.name}!\n\nRecebemos um pedido de acesso ao Inside Chat com este e-mail. Para continuar, abra o link, confirme que foi você e escolha sua senha:\n${config.publicUrl}/verificar?t=${issued.token}\n\nDepois disso, o administrador vai analisar o pedido e você será avisado por e-mail. O link vale por ${config.approvalTtlHours} horas.\n\nSe NÃO foi você quem pediu, não clique no link: basta ignorar esta mensagem.`,
  }).catch((e) => log(`falha ao enviar e-mail de confirmação: ${(e as { code?: string }).code ?? 'erro'}`)); // sem o link no log
}

function pendingByToken(db: Db, token: string, kind: Kind): Row {
  const row = db.prepare(
    `SELECT a.id AS approval_id, u.id AS user_id, u.name, u.email, u.created_at, u.email_verified_at
     FROM signup_approvals a JOIN users u ON u.id = a.user_id
     WHERE a.token_hash = ? AND a.kind = ? AND a.used_at IS NULL AND a.expires_at > ? AND u.status = 'pending'`,
  ).get(sha256(token), kind, new Date().toISOString()) as Row | undefined;
  if (!row) throw new HttpError(410, 'Este link é inválido, expirou ou já foi usado.', 'gone');
  return row;
}

export function describeVerification(db: Db, token: string) {
  const r = pendingByToken(db, token, 'verify');
  return { name: r.name, email: r.email };
}

/** O solicitante confirmou o e-mail: só agora o aprovador é avisado. */
export function verifyEmail(db: Db, mailer: Mailer, token: string, password: string, log: (msg: string) => void = () => {}): { name: string; email: string } {
  const r = pendingByToken(db, token, 'verify');
  const passwordHash = hashPassword(password);
  const approvalToken = tx(db, () => {
    const now = new Date().toISOString();
    // A senha é definida por quem comprovou controlar o e-mail.
    db.prepare('UPDATE users SET email_verified_at = ?, password_hash = ? WHERE id = ?').run(now, passwordHash, r.user_id);
    db.prepare(`UPDATE signup_approvals SET used_at = ? WHERE user_id = ? AND kind = 'verify' AND used_at IS NULL`).run(now, r.user_id);
    audit(db, null, 'signup.email_verified', 'user', r.user_id);
    return issueToken(db, r.user_id, 'approval');
  });
  mailer.send({
    to: config.approvalEmail,
    subject: 'Inside Chat: novo cadastro aguardando aprovação',
    text: `Pedido de acesso ao Inside Chat (o solicitante confirmou que controla este e-mail):\n  Nome informado: "${oneLine(r.name)}"\n  E-mail: ${r.email}\n\nAprove somente se reconhecer quem está pedindo. Para aprovar ou recusar, abra o link abaixo (vale por ${config.approvalTtlHours} horas e só pode ser usado uma vez):\n${config.publicUrl}/aprovar?t=${approvalToken}\n\nSe não reconhece este pedido, recuse ou ignore este e-mail.`,
  }).catch((e) => log(`falha ao enviar e-mail de aprovação: ${(e as { code?: string }).code ?? 'erro'}`));
  return { name: r.name, email: r.email };
}

export function describeApproval(db: Db, token: string) {
  const r = pendingByToken(db, token, 'approval');
  return { name: r.name, email: r.email, requestedAt: r.created_at };
}

/** Aprova ou recusa. Usado pelo link do e-mail (actorId = null) e pelo painel do admin. */
export async function decideSignup(
  db: Db, mailer: Mailer, userId: number, decision: 'approve' | 'reject', actorId: number | null,
): Promise<{ name: string; email: string }> {
  const user = tx(db, () => {
    const u = db.prepare(`SELECT id, name, email, email_verified_at FROM users WHERE id = ? AND status = 'pending'`).get(userId) as Row | undefined;
    if (!u) throw new HttpError(404, 'Cadastro pendente não encontrado');
    if (decision === 'approve' && !u.email_verified_at) throw new HttpError(409, 'O solicitante ainda não confirmou o e-mail.', 'unverified');
    db.prepare('UPDATE users SET status = ?, active = ? WHERE id = ?').run(decision === 'approve' ? 'approved' : 'rejected', decision === 'approve' ? 1 : 0, userId);
    db.prepare('UPDATE signup_approvals SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(new Date().toISOString(), userId);
    audit(db, actorId, decision === 'approve' ? 'signup.approve' : 'signup.reject', 'user', userId, { via: actorId ? 'painel' : 'e-mail' });
    return u;
  });
  const text = decision === 'approve'
    ? `Olá! Seu acesso ao Inside Chat foi aprovado. Entre em ${config.publicUrl} com o e-mail e a senha que você cadastrou.`
    : `Olá! Seu pedido de acesso ao Inside Chat não foi aprovado. Em caso de dúvida, fale com o administrador.`;
  // Só escreve a quem comprovou o e-mail (aprovar já exige isso); recusa de e-mail não confirmado fica só no painel.
  if (decision === 'approve' || user.email_verified_at) mailer.send({ to: user.email, subject: decision === 'approve' ? 'Inside Chat: acesso aprovado' : 'Inside Chat: cadastro não aprovado', text }).catch(() => {});
  return { name: user.name, email: user.email };
}

/**
 * Admin reabre um cadastro recusado: volta a "pendente" (continua sem acesso).
 * Se o solicitante já tinha confirmado o e-mail, o admin pode aprovar pelo painel; senão ele precisa
 * refazer o pedido para receber outro link de confirmação. Evita que uma recusa bloqueie o e-mail para sempre.
 */
export function reopenSignup(db: Db, mailer: Mailer, userId: number, actorId: number): { verified: boolean } {
  const reopened = tx(db, () => {
    const u = db.prepare(`SELECT id, email_verified_at FROM users WHERE id = ? AND status = 'rejected'`).get(userId) as Row | undefined;
    if (!u) throw new HttpError(404, 'Cadastro recusado não encontrado');
    // created_at renovado: a limpeza de cadastros não confirmados conta a partir da reabertura.
    db.prepare(`UPDATE users SET status = 'pending', active = 0, created_at = ? WHERE id = ?`).run(new Date().toISOString(), userId);
    audit(db, actorId, 'signup.reopen', 'user', userId);
    const row = db.prepare('SELECT name, email FROM users WHERE id = ?').get(userId) as Row;
    return { verified: Boolean(u.email_verified_at), name: row.name as string, email: row.email as string };
  });
  // Só avisa quem já confirmou o e-mail; sem link, só informa. Falha de envio não desfaz a reabertura.
  if (reopened.verified) {
    mailer.send({ to: reopened.email, subject: 'Inside Chat: seu pedido foi reaberto', text: `Olá! Seu pedido de acesso ao Inside Chat foi reaberto. O administrador vai analisar novamente e você será avisado por e-mail.` }).catch(() => {});
  }
  return { verified: reopened.verified };
}

/**
 * Link de aprovação expirado (ou já substituído): quem o abriu pede um novo. O link novo vai SEMPRE e só
 * para o aprovador configurado, nunca para quem fez o pedido, então a rota pública não concede acesso a ninguém.
 * Resposta igual para token desconhecido, cadastro já decidido ou limite atingido (não revela estado).
 */
export function resendApproval(db: Db, mailer: Mailer, token: string, log: (msg: string) => void = () => {}): void {
  const issued = tx(db, () => {
    const r = db.prepare(
      `SELECT u.id AS user_id, u.name, u.email FROM signup_approvals a JOIN users u ON u.id = a.user_id
       WHERE a.token_hash = ? AND a.kind = 'approval' AND u.status = 'pending' AND u.email_verified_at IS NOT NULL`,
    ).get(sha256(token)) as Row | undefined;
    if (!r) return null;
    const sent = (db.prepare(`SELECT COUNT(*) AS n FROM signup_approvals WHERE user_id = ? AND kind = 'approval'`).get(r.user_id) as Row).n as number;
    if (sent >= MAX_APPROVAL_EMAILS) return null;
    const recent = db.prepare(`SELECT 1 FROM signup_approvals WHERE user_id = ? AND kind = 'approval' AND created_at > ?`)
      .get(r.user_id, new Date(Date.now() - 5 * 60_000).toISOString());
    if (recent) return null;
    audit(db, null, 'signup.approval_resent', 'user', r.user_id as number);
    return { token: issueToken(db, r.user_id as number, 'approval'), name: r.name as string, email: r.email as string };
  });
  if (!issued) return;
  mailer.send({
    to: config.approvalEmail,
    subject: 'Inside Chat: novo link para aprovar cadastro',
    text: `Novo link de aprovação (o anterior deixou de valer):
  Nome informado: "${oneLine(issued.name)}"
  E-mail: ${issued.email}

Abra para aprovar ou recusar (vale por ${config.approvalTtlHours} horas e só pode ser usado uma vez):
${config.publicUrl}/aprovar?t=${issued.token}

Se não reconhece este pedido, recuse ou ignore este e-mail.`,
  }).catch((e) => log(`falha ao reenviar e-mail de aprovação: ${(e as { code?: string }).code ?? 'erro'}`));
}

export async function decideByToken(db: Db, mailer: Mailer, token: string, decision: 'approve' | 'reject') {
  const r = pendingByToken(db, token, 'approval');
  return decideSignup(db, mailer, r.user_id, decision, null);
}
