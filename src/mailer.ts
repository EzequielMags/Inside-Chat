import { lookup } from 'node:dns/promises';
import type { Config } from './config.ts';

export interface Mail { to: string; subject: string; text: string }
export interface Mailer { send(mail: Mail): Promise<void> }

/** SMTP (ex.: Gmail com senha de app). nodemailer só é carregado se houver SMTP configurado. */
export class SmtpMailer implements Mailer {
  private cfg: Config['smtp'];
  constructor(cfg: Config['smtp']) { this.cfg = cfg; }
  async send(mail: Mail) {
    const { default: nodemailer } = await import('nodemailer');
    // O resolvedor interno do nodemailer estoura o timeout em algumas redes (IPv6); o DNS do sistema resolve rápido.
    const { address } = await lookup(this.cfg.host, { family: 4 });
    const transport = nodemailer.createTransport({
      host: address, tls: { servername: this.cfg.host }, port: this.cfg.port, secure: this.cfg.port === 465,
      auth: { user: this.cfg.user, pass: this.cfg.pass },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
    });
    await transport.sendMail({ from: this.cfg.from || this.cfg.user, to: mail.to, subject: mail.subject, text: mail.text });
  }
}

/** Sem SMTP: em desenvolvimento imprime o e-mail no console; em produção nunca imprime (o link é uma credencial). */
export class ConsoleMailer implements Mailer {
  private production: boolean;
  constructor(production: boolean) { this.production = production; }
  async send(mail: Mail) {
    if (this.production) { console.warn(`[mailer] SMTP não configurado: e-mail "${mail.subject}" não enviado.`); return; }
    console.log(`\n--- E-mail (modo desenvolvimento) ---\nPara: ${mail.to}\nAssunto: ${mail.subject}\n\n${mail.text}\n-------------------------------------\n`);
  }
}

export function makeMailer(cfg: Config): Mailer {
  if (cfg.smtp.user && cfg.smtp.pass) return new SmtpMailer(cfg.smtp);
  // Só imprime o link (uma credencial) em ambiente claramente local.
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(cfg.publicUrl);
  return new ConsoleMailer(cfg.production || !local);
}
