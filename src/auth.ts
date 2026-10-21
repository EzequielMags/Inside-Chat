import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import type { Db, Row } from './db.ts';
import { audit } from './db.ts';
import { config } from './config.ts';

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'agent';
  teamIds: number[];
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function createSession(db: Db, userId: number): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.sessionDays * 86_400_000);
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?,?,?)').run(sha256(token), userId, expiresAt.toISOString());
  return { token, expiresAt };
}

export function destroySession(db: Db, token: string) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sha256(token));
}

export function loadUserByToken(db: Db, token: string | undefined): SessionUser | null {
  if (!token) return null;
  const row = db.prepare(
    `SELECT u.id, u.name, u.email, u.role FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ? AND u.active = 1`,
  ).get(sha256(token), new Date().toISOString()) as Row | undefined;
  if (!row) return null;
  const teamIds = (db.prepare('SELECT team_id FROM team_members WHERE user_id = ?').all(row.id) as Row[]).map((r) => r.team_id);
  return { id: row.id, name: row.name, email: row.email, role: row.role, teamIds };
}

export function authenticate(db: Db, email: string, password: string): Row | null {
  // Não filtra por active/status: quem chama decide (login distingue "aguardando aprovação" só depois de a senha conferir).
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase()) as Row | undefined;
  // Executa o hash mesmo sem usuário para não vazar a existência da conta pelo tempo de resposta.
  const ok = verifyPassword(password, user?.password_hash ?? 'scrypt$00$00');
  return user && ok ? user : null;
}

/** Cria o primeiro admin se o banco estiver vazio. Retorna a senha gerada, se houver. */
export function ensureFirstAdmin(db: Db): { email: string; password: string; generated: boolean } | null {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as Row).n as number;
  if (count > 0) return null;
  const generated = !config.seedAdminPassword;
  const password = config.seedAdminPassword || randomBytes(9).toString('base64url');
  const info = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)')
    .run('Administrador', config.seedAdminEmail.toLowerCase(), hashPassword(password), 'admin');
  audit(db, null, 'user.seed_admin', 'user', Number(info.lastInsertRowid));
  return { email: config.seedAdminEmail, password, generated };
}

/** Limitador simples em memória para tentativas de login (por IP+e-mail). */
export class LoginLimiter {
  private hits = new Map<string, { n: number; reset: number }>();
  private max: number;
  private windowMs: number;
  constructor(max = 10, windowMs = 15 * 60_000) { this.max = max; this.windowMs = windowMs; }
  blocked(key: string): boolean {
    const h = this.hits.get(key);
    if (!h || h.reset < Date.now()) return false;
    return h.n >= this.max;
  }
  fail(key: string) {
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (v.reset < Date.now()) this.hits.delete(k);
    const h = this.hits.get(key);
    if (!h || h.reset < Date.now()) this.hits.set(key, { n: 1, reset: Date.now() + this.windowMs });
    else h.n++;
  }
  clear(key: string) { this.hits.delete(key); }
}
