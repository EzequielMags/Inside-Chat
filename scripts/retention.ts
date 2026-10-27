// Uso: node scripts/retention.ts            -> simulação (só conta)
//      node scripts/retention.ts --apply    -> apaga de verdade (faça backup antes)
import { config } from '../src/config.ts';
import { openDb } from '../src/db.ts';
import { purgeResolved } from '../src/maintenance.ts';

if (config.retentionDays < 1) {
  console.error('RETENTION_DAYS não definido (0 = desligado). Defina o prazo com o jurídico antes de aplicar.');
  process.exit(1);
}
const apply = process.argv.includes('--apply');
const db = openDb(config.dbPath);
const r = purgeResolved(db, config.retentionDays, apply);
db.close();
console.log(`${apply ? 'Apagado' : 'Simulação (nada apagado)'}: ${r.conversations} conversa(s) resolvidas há mais de ${config.retentionDays} dias, ${r.messages} mensagem(ns)${apply ? `, ${r.customers} cliente(s) sem conversa` : ''}.`);
if (!apply) console.log('Rode com --apply para aplicar.');
