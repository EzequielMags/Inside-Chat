import { config, productionProblems } from './config.ts';
import { openDb } from './db.ts';
import { ensureFirstAdmin } from './auth.ts';
import { buildApp } from './app.ts';
import { makeMailer } from './mailer.ts';
import { MockChannel, WhatsAppCloudChannel } from './channels/whatsapp.ts';

const problems = productionProblems(config);
if (problems.length) {
  console.error(['Configuração de produção inválida:', ...problems.map((p) => `  - ${p}`)].join('\n'));
  process.exit(1);
}

const db = openDb(config.dbPath);
const channel = config.whatsapp.mode === 'cloud' ? new WhatsAppCloudChannel(config.whatsapp) : new MockChannel();
const mailer = makeMailer(config);
const app = await buildApp({ db, channel, mailer, logger: true });
if (!(config.smtp.user && config.smtp.pass)) {
  console.warn(`[cadastro] SMTP não configurado: e-mails de aprovação ${config.production ? 'NÃO serão enviados (use o painel de Administração)' : 'serão impressos neste console'}.`);
} else {
  console.log(`[cadastro] aprovações vão para ${config.approvalEmail}`);
}

const seeded = ensureFirstAdmin(db);
if (seeded) {
  console.log('\n=== Primeiro administrador criado ===');
  console.log(`  e-mail: ${seeded.email}`);
  console.log(`  senha:  ${seeded.password}${seeded.generated ? '   (gerada agora; anote e troque depois)' : ''}\n`);
}

await app.listen({ port: config.port, host: config.host });
console.log(`Inside Chat no ar: http://localhost:${config.port}  (WhatsApp: modo ${config.whatsapp.mode})`);

const shutdown = async () => { await app.close(); db.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
