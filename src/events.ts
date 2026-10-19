import { EventEmitter } from 'node:events';

/** Barramento em memória que alimenta o SSE. Eventos carregam apenas ids (sem conteúdo de mensagem). */
export interface AppEvent {
  type: 'conversation.updated' | 'conversation.created';
  conversationId: number;
}

export const bus = new EventEmitter();
bus.setMaxListeners(0);

export const emit = (e: AppEvent) => bus.emit('event', e);
