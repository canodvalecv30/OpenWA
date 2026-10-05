import { EventEmitter } from 'events';
import type { Client } from 'whatsapp-web.js';
import { createLogger } from '../../common/services/logger.service';
import { type WwebjsEngineHost } from './wwebjs-host';
import { registerWwebjsMessageEvents } from './wwebjs-message-events';

/**
 * whatsapp-web.js stamps an own message in a LID chat (and in a LID-addressing-mode group) with
 * `from` = the account's own LID, while the account wid is the phone dialect. The chat of a revoked
 * message therefore follows the direction flag, as `Message._getChatId` does, not a comparison of
 * `from` against the account wid.
 */
function wire(): { client: EventEmitter; onMessageRevoked: jest.Mock } {
  const client = new EventEmitter();
  const onMessageRevoked = jest.fn();
  const host = {
    logger: createLogger('wwebjs-revoke-chat-id.spec'),
    getCallbacks: () => ({ onMessageRevoked }),
  } as unknown as WwebjsEngineHost;
  registerWwebjsMessageEvents(client as unknown as Client, host);
  return { client, onMessageRevoked };
}

describe('wwebjs message_revoke_everyone chatId', () => {
  it('reports the peer when the account revokes its own message in a LID chat', () => {
    const { client, onMessageRevoked } = wire();
    client.emit('message_revoke_everyone', {
      id: { _serialized: 'R', fromMe: true },
      fromMe: true,
      from: '777000@lid',
      to: '99999@lid',
      timestamp: 1,
    });
    expect(onMessageRevoked).toHaveBeenCalledWith(expect.objectContaining({ chatId: '99999@lid' }));
  });

  it('reports the group when a member revokes a message there', () => {
    const { client, onMessageRevoked } = wire();
    client.emit('message_revoke_everyone', {
      id: { _serialized: 'R2', fromMe: false },
      fromMe: false,
      from: '120363000@g.us',
      to: '628111@c.us',
      timestamp: 2,
    });
    expect(onMessageRevoked).toHaveBeenCalledWith(expect.objectContaining({ chatId: '120363000@g.us' }));
  });
});
