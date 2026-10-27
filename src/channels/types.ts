/** Contrato que qualquer canal (WhatsApp, e-mail, Instagram...) implementa para enviar mensagens. */
export interface Channel {
  readonly name: string;
  sendText(to: string, body: string): Promise<{ externalId: string }>;
  sendTemplate(to: string, template: { name: string; language: string }, params: string[]): Promise<{ externalId: string }>;
}

/** Mensagem recebida já normalizada, independente do canal de origem. */
export interface InboundMessage {
  channel: string;
  phone: string;
  contactName?: string;
  body: string;
  externalId: string;
  timestamp?: Date;
}

export interface StatusUpdate {
  externalId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  error?: string;
}

/** Erro de envio já traduzido: mensagem curta, em pt-BR, segura para gravar e exibir (sem resposta crua do provedor). */
export class ChannelError extends Error {
  readonly code?: number;
  constructor(message: string, code?: number) { super(message); this.code = code; }
}
