// Uso: node scripts/backup.ts   (agende no cron/Agendador de Tarefas; a pasta de backup deve ficar em disco criptografado)
import { config } from '../src/config.ts';
import { openDb } from '../src/db.ts';
import { backupDb } from '../src/maintenance.ts';

const db = openDb(config.dbPath);
const file = backupDb(db, config.backupDir, config.backupKeep);
db.close();
console.log(`Backup criado: ${file} (mantidos os ${config.backupKeep} mais recentes)`);
