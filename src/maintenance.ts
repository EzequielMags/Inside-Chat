import { chmodSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db.ts';
import { audit, tx } from './db.ts';

export interface PurgeResult { conversations: number; messages: number; customers: number; applied: boolean }

/**
 * Retenção LGPD: apaga conversas resolvidas há mais de `days` dias (mensagens saem em cascata) e os clientes
 * que ficarem sem nenhuma conversa. Sem `apply` só conta (dry-run). O `audit_log` guarda apenas as contagens.
 */
export function purgeResolved(db: Db, days: number, apply: boolean, now = new Date()): PurgeResult {
  if (!Number.isInteger(days) || days < 1) throw new Error('Informe RETENTION_DAYS (inteiro >= 1) para aplicar retenção');
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
  const count = (sql: string) => (db.prepare(sql).get(cutoff) as { n: number }).n;
  const res: PurgeResult = {
    conversations: count(`SELECT COUNT(*) n FROM conversations WHERE status = 'resolved' AND resolved_at < ?`),
    messages: count(`SELECT COUNT(*) n FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE status = 'resolved' AND resolved_at < ?)`),
    customers: 0,
    applied: false,
  };
  if (!apply) return res;
  const done = tx(db, () => {
    const owners = (db.prepare(`SELECT DISTINCT customer_id FROM conversations WHERE status = 'resolved' AND resolved_at < ?`).all(cutoff) as { customer_id: number }[]).map((r) => r.customer_id);
    db.prepare(`DELETE FROM conversations WHERE status = 'resolved' AND resolved_at < ?`).run(cutoff);
    // Só remove clientes que perderam conversas agora e ficaram sem nenhuma (não mexe em cadastros manuais).
    const dropCustomer = db.prepare(`DELETE FROM customers WHERE id = ? AND NOT EXISTS (SELECT 1 FROM conversations WHERE customer_id = customers.id)`);
    for (const id of owners) res.customers += Number(dropCustomer.run(id).changes);
    db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(now.toISOString());
    res.applied = true;
    audit(db, null, 'retention.purge', 'system', null, { days, conversations: res.conversations, messages: res.messages, customers: res.customers });
    return res;
  });
  // secure_delete zera as páginas liberadas; o checkpoint tira o conteúdo apagado do arquivo -wal.
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  return done;
}

/** Cópia consistente do banco (inclui o WAL) via VACUUM INTO, com rotação das mais antigas. Retorna o caminho gerado. */
export function backupDb(db: Db, dir: string, keep: number, now = new Date()): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
  const file = join(dir, `cordial-${stamp}.db`);
  db.prepare('VACUUM INTO ?').run(file);
  chmodSync(file, 0o600); // contém telefones, mensagens e hashes: só o dono lê
  const all = readdirSync(dir).filter((f) => /^cordial-\d{8}-\d{6}\.db$/.test(f)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - Math.max(1, keep)))) rmSync(join(dir, old), { force: true });
  return file;
}
