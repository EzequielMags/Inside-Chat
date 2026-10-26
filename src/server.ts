import { config } from './config.ts';
import { openDb } from './db.ts';
import { ensureFirstAdmin } from './auth.ts';
import { buildApp } from './app.ts';
import { makeMailer } from './mailer.ts';
import { MockChannel, WhatsAppCloudChannel } from './channels/whatsapp.ts';

const db = openDb(config.dbPath);
const channel = config.whatsapp.mode === 'cloud' ? new WhatsAppCloudChannel(config.whatsapp) : new MockChannel();
if (config.production && !config.publicUrl.startsWith('https://')) throw new Error('Em produção, PUBLIC_URL precisa começar com https://');
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

await app.listen({ port: config.port, host: process.env.HOST ?? '127.0.0.1' });
console.log(`Cordial no ar: http://localhost:${config.port}  (WhatsApp: modo ${config.whatsapp.mode})`);

const shutdown = async () => { await app.close(); db.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
