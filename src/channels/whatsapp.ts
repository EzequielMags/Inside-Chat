import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import type { Channel, InboundMessage, StatusUpdate } from './types.ts';
import type { Config } from '../config.ts';

/** Valida X-Hub-Signature-256 sobre o corpo bruto da requisição. */
export function verifySignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!appSecret || !header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const given = Buffer.from(header.slice(7), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const TYPE_LABELS: Record<string, string> = {
  image: '[imagem]', audio: '[áudio]', video: '[vídeo]', document: '[documento]',
  sticker: '[figurinha]', location: '[localização]', contacts: '[contato]', reaction: '[reação]',
};

/** Converte o payload do webhook da Cloud API em mensagens e atualizações de status. */
export function parseWebhook(payload: any): { messages: InboundMessage[]; statuses: StatusUpdate[] } {
  const messages: InboundMessage[] = [];
  const statuses: StatusUpdate[] = [];
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value ?? {};
      const names = new Map<string, string>();
      for (const c of value.contacts ?? []) if (c?.wa_id) names.set(c.wa_id, c?.profile?.name ?? '');
      for (const m of value.messages ?? []) {
        if (!m?.id || !m?.from) continue;
        let body: string;
        if (m.type === 'text') body = m.text?.body ?? '';
        else if (m.type === 'button') body = m.button?.text ?? '[botão]';
        else if (m.type === 'interactive') body = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '[interativo]';
        else body = TYPE_LABELS[m.type] ?? '[mensagem não suportada]';
        messages.push({
          channel: 'whatsapp',
          phone: String(m.from),
          contactName: names.get(m.from) || undefined,
          body,
          externalId: String(m.id),
          timestamp: m.timestamp ? new Date(Number(m.timestamp) * 1000) : undefined,
        });
      }
      for (const s of value.statuses ?? []) {
        if (!s?.id || !['sent', 'delivered', 'read', 'failed'].includes(s.status)) continue;
        statuses.push({
          externalId: String(s.id),
          status: s.status,
          error: s.errors?.[0] ? `${s.errors[0].code}: ${s.errors[0].title ?? s.errors[0].message ?? ''}` : undefined,
        });
      }
    }
  }
  return { messages, statuses };
}

export class WhatsAppCloudChannel implements Channel {
  readonly name = 'whatsapp';
  private cfg: Config['whatsapp'];
  constructor(cfg: Config['whatsapp']) { this.cfg = cfg; }

  private async post(payload: object): Promise<{ externalId: string }> {
    const url = `https://graph.facebook.com/${this.cfg.apiVersion}/${this.cfg.phoneNumberId}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.cfg.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
      signal: AbortSignal.timeout(15_000),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${json?.error?.message ?? 'erro desconhecido'}`);
    const id = json?.messages?.[0]?.id;
    if (!id) throw new Error('WhatsApp API não retornou o id da mensagem');
    return { externalId: id };
  }

  sendText(to: string, body: string) {
    return this.post({ to, type: 'text', text: { body, preview_url: false } });
  }

  sendTemplate(to: string, template: { name: string; language: string }, params: string[]) {
    return this.post({
      to,
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.language },
        ...(params.length ? { components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] } : {}),
      },
    });
  }
}

/** Canal de desenvolvimento: não chama a Meta, apenas gera ids. */
export class MockChannel implements Channel {
  readonly name = 'whatsapp';
  sent: Array<{ to: string; body: string }> = [];
  async sendText(to: string, body: string) {
    this.sent.push({ to, body });
    return { externalId: `mock.${randomUUID()}` };
  }
  async sendTemplate(to: string, t: { name: string; language: string }, params: string[]) {
    this.sent.push({ to, body: `template:${t.name}(${params.join(',')})` });
    return { externalId: `mock.${randomUUID()}` };
  }
}
