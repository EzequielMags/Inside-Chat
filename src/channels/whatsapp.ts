import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { ChannelError, type Channel, type InboundMessage, type StatusUpdate } from './types.ts';
import type { Config } from '../config.ts';

/** Valida X-Hub-Signature-256 sobre o corpo bruto da requisição. */
export function verifySignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!appSecret || !header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const given = Buffer.from(header.slice(7), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const GRAPH_ERRORS: Record<number, string> = {
  190: 'Token do WhatsApp inválido ou expirado. Avise o administrador.',
  10: 'O app não tem permissão para enviar mensagens. Avise o administrador.',
  200: 'O app não tem permissão para enviar mensagens. Avise o administrador.',
  4: 'Limite de envios da Meta atingido. Tente novamente em alguns minutos.',
  80007: 'Limite de envios da Meta atingido. Tente novamente em alguns minutos.',
  130429: 'Limite de envios da Meta atingido. Tente novamente em alguns minutos.',
  131056: 'Muitas mensagens para este cliente em pouco tempo. Aguarde um pouco.',
  131026: 'Mensagem não entregue: o número não usa WhatsApp ou não aceitou o contato.',
  131030: 'Número do cliente não autorizado (modo de teste da Meta).',
  131047: 'Janela de 24 h encerrada: envie um template aprovado.',
  131048: 'Envio bloqueado pela Meta por suspeita de spam.',
  131049: 'A Meta não entregou esta mensagem para manter a qualidade do número.',
  131051: 'Tipo de mensagem não suportado.',
  132000: 'Quantidade de parâmetros do template diferente da aprovada na Meta.',
  132001: 'Template não existe na Meta com este nome e idioma.',
  132005: 'Texto do template ficou grande demais depois de preencher os parâmetros.',
  132007: 'Template violou uma política da Meta.',
  132012: 'Parâmetro do template em formato inválido.',
  132015: 'Template pausado pela Meta por baixa qualidade.',
  132016: 'Template desativado pela Meta.',
};

/** Traduz o código de erro da Graph API (envio ou status `failed`) para texto curto em pt-BR. */
export function describeGraphError(code: number | undefined, httpStatus?: number): string {
  if (code !== undefined && GRAPH_ERRORS[code]) return GRAPH_ERRORS[code];
  if (httpStatus === 401) return GRAPH_ERRORS[190];
  if (httpStatus === 429) return GRAPH_ERRORS[4];
  return code !== undefined ? `Falha no envio pelo WhatsApp (código ${code}).` : 'Falha no envio pelo WhatsApp.';
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
          error: s.status === 'failed' ? describeGraphError(Number(s.errors?.[0]?.code) || undefined) : undefined,
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
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.cfg.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ChannelError('Não foi possível contatar o WhatsApp (tempo esgotado ou sem rede).');
    }
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new ChannelError(describeGraphError(Number(json?.error?.code) || undefined, res.status), Number(json?.error?.code) || undefined);
    const id = json?.messages?.[0]?.id;
    if (!id) throw new ChannelError('O WhatsApp não confirmou o envio da mensagem.');
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
