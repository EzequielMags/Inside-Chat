// Dados de demonstração para desenvolvimento local. NUNCA rode em produção.
import { config } from './config.ts';
import { openDb } from './db.ts';
import { hashPassword } from './auth.ts';
import { ingestInbound } from './domain.ts';

if (config.production) throw new Error('seed:demo não pode rodar em produção');

const db = openDb(config.dbPath);
const pw = hashPassword('demo12345');
const user = (name: string, email: string, role: string) =>
  db.prepare('INSERT OR IGNORE INTO users (name, email, password_hash, role) VALUES (?,?,?,?)').run(name, email, pw, role);

user('Administrador', config.seedAdminEmail.toLowerCase(), 'admin');
user('Ana Souza', 'ana@cordial.local', 'agent');
user('Bruno Lima', 'bruno@cordial.local', 'agent');
db.prepare("INSERT OR IGNORE INTO teams (name) VALUES ('Suporte'), ('Financeiro')").run();
const team = (n: string) => (db.prepare('SELECT id FROM teams WHERE name = ?').get(n) as any).id;
const uid = (e: string) => (db.prepare('SELECT id FROM users WHERE email = ?').get(e) as any).id;
db.prepare('INSERT OR IGNORE INTO team_members VALUES (?,?)').run(team('Suporte'), uid('ana@cordial.local'));
db.prepare('INSERT OR IGNORE INTO team_members VALUES (?,?)').run(team('Financeiro'), uid('bruno@cordial.local'));
db.prepare("INSERT OR IGNORE INTO templates (name, language, category, body) VALUES ('retorno_atendimento','pt_BR','UTILITY','Olá {{1}}, aqui é da equipe de atendimento. Podemos continuar sua solicitação?')").run();

const samples: Array<[string, string, string]> = [
  ['5511988880001', 'Carla Mendes', 'Olá, preciso da segunda via do boleto.'],
  ['5511988880002', 'Diego Alves', 'Bom dia! Meu pedido ainda não chegou.'],
  ['5511988880003', 'Elisa Prado', 'Vocês atendem aos sábados?'],
];
for (const [phone, name, body] of samples) {
  ingestInbound(db, { channel: 'whatsapp', phone, contactName: name, body, externalId: `demo.${phone}` });
}
console.log('Demo pronta. Usuários (senha demo12345): ana@cordial.local, bruno@cordial.local, e o admin com a mesma senha se criado agora.');
console.log('Obs.: se o admin já existia, a senha dele continua a original.');
db.close();
