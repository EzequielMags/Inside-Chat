import { config, productionProblems } from './config.ts';
import { openDb } from './db.ts';
import { ensureFirstAdmin } from './auth.ts';
import { buildApp } from './app.ts';
import { MockChannel, WhatsAppCloudChannel } from './channels/whatsapp.ts';

const problems = productionProblems(config);
if (problems.length) {
  console.error(['Configuração de produção inválida:', ...problems.map((p) => `  - ${p}`)].join('\n'));
  process.exit(1);
}

const db = openDb(config.dbPath);
const channel = config.whatsapp.mode === 'cloud' ? new WhatsAppCloudChannel(config.whatsapp) : new MockChannel();
const app = await buildApp({ db, channel, logger: true });

const seeded = ensureFirstAdmin(db);
if (seeded) {
  console.log('\n=== Primeiro administrador criado ===');
  console.log(`  e-mail: ${seeded.email}`);
  console.log(`  senha:  ${seeded.password}${seeded.generated ? '   (gerada agora; anote e troque depois)' : ''}\n`);
}

await app.listen({ port: config.port, host: config.host });
console.log(`Cordial no ar: http://localhost:${config.port}  (WhatsApp: modo ${config.whatsapp.mode})`);

const shutdown = async () => { await app.close(); db.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
