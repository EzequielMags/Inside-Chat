import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3000),
  production: env.NODE_ENV === 'production',
  dbPath: env.DB_PATH ?? 'data/cordial.db',
  timezone: env.TIMEZONE ?? 'America/Sao_Paulo',
  // Offset fixo usado para limites de data nos filtros (Brasil não tem horário de verão desde 2019).
  tzOffset: env.TZ_OFFSET ?? '-03:00',
  windowHours: 24,
  sessionDays: 7,
  seedAdminEmail: env.SEED_ADMIN_EMAIL ?? 'admin@cordial.local',
  seedAdminPassword: env.SEED_ADMIN_PASSWORD ?? '',
  whatsapp: {
    mode: (env.WA_MODE ?? 'mock') as 'mock' | 'cloud',
    verifyToken: env.WA_VERIFY_TOKEN ?? '',
    appSecret: env.WA_APP_SECRET ?? '',
    accessToken: env.WA_ACCESS_TOKEN ?? '',
    phoneNumberId: env.WA_PHONE_NUMBER_ID ?? '',
    apiVersion: env.WA_API_VERSION ?? 'v21.0',
  },
};

export type Config = typeof config;
