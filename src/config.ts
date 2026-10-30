import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3000),
  nodeEnv: env.NODE_ENV ?? 'development',
  production: env.NODE_ENV === 'production',
  dbPath: env.DB_PATH ?? 'data/cordial.db',
  timezone: env.TIMEZONE ?? 'America/Sao_Paulo',
  // Offset fixo usado para limites de data nos filtros (Brasil não tem horário de verão desde 2019).
  tzOffset: env.TZ_OFFSET ?? '-03:00',
  host: env.HOST ?? '127.0.0.1',
  // Retenção LGPD: dias após a resolução para apagar conversas. 0 = desligado (prazo a definir com o jurídico).
  retentionDays: Number(env.RETENTION_DAYS ?? 0),
  backupDir: env.BACKUP_DIR ?? 'backups',
  backupKeep: Number(env.BACKUP_KEEP ?? 14),
  windowHours: 24,
  sessionDays: 7,
  seedAdminEmail: env.SEED_ADMIN_EMAIL ?? 'admin@cordial.local',
  seedAdminPassword: env.SEED_ADMIN_PASSWORD ?? '',
  // Número de proxies reversos confiáveis na frente do app (0 = nenhum). Nunca "true": aceitaria X-Forwarded-For forjado.
  trustProxy: Math.max(0, Number(env.TRUST_PROXY) || 0),
  // Cadastro: quem aprova recebe um e-mail com link de uso único.
  publicUrl: (env.PUBLIC_URL ?? `http://localhost:${env.PORT ?? 3000}`).replace(/\/+$/, ''),
  approvalEmail: (env.APPROVAL_EMAIL ?? env.SEED_ADMIN_EMAIL ?? 'admin@cordial.local').toLowerCase(),
  approvalTtlHours: 72,
  smtp: {
    host: env.SMTP_HOST ?? 'smtp.gmail.com',
    port: Number(env.SMTP_PORT ?? 465),
    user: env.SMTP_USER ?? '',
    pass: env.SMTP_PASS ?? '',
    from: env.SMTP_FROM ?? '',
  },
  whatsapp: {
    mode: (env.WA_MODE ?? 'mock') as 'mock' | 'cloud',
    verifyToken: env.WA_VERIFY_TOKEN ?? '',
    appSecret: env.WA_APP_SECRET ?? '',
    accessToken: env.WA_ACCESS_TOKEN ?? '',
    phoneNumberId: env.WA_PHONE_NUMBER_ID ?? '',
    apiVersion: env.WA_API_VERSION ?? 'v21.0',
  },
};

/** Problemas que impedem subir em produção. Lista vazia = ok. */
export function productionProblems(c: Config): string[] {
  const out: string[] = [];
  // Falha fechada: um NODE_ENV com typo ("prod") não pode desligar as checagens, nem expor o app fora do loopback.
  if (!['development', 'test', 'production'].includes(c.nodeEnv)) out.push('NODE_ENV deve ser development, test ou production');
  else if (!c.production && !['127.0.0.1', 'localhost', '::1'].includes(c.host)) out.push('HOST fora do loopback exige NODE_ENV=production');
  if (!c.production) return out;
  if (!/^https:\/\/[^/]+/.test(c.publicUrl)) out.push('PUBLIC_URL deve ser uma URL https (ex.: https://atendimento.exemplo.com.br)');
  if (!Number.isInteger(c.trustProxy) || c.trustProxy < 0) out.push('TRUST_PROXY deve ser um inteiro >= 0 (nº de proxies à frente do app)');
  if (c.whatsapp.mode !== 'cloud') out.push('WA_MODE deve ser "cloud" em produção (o modo mock expõe o simulador)');
  if (c.whatsapp.verifyToken.length < 16 || c.whatsapp.verifyToken === 'troque-por-um-token-longo') {
    out.push('WA_VERIFY_TOKEN precisa ser um segredo aleatório com 16+ caracteres');
  }
  if (c.seedAdminPassword && c.seedAdminPassword.length < 12) out.push('SEED_ADMIN_PASSWORD com menos de 12 caracteres (ou deixe vazio para gerar uma)');
  if (!Number.isInteger(c.retentionDays) || c.retentionDays < 0) out.push('RETENTION_DAYS deve ser um inteiro >= 0');
  return out;
}

export type Config = typeof config;
