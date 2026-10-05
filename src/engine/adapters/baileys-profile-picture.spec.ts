import { Boom } from '@hapi/boom';
import type { WASocket } from '@whiskeysockets/baileys';
import { BaileysContacts, BaileysContactsHost } from './baileys-contacts';
import { EngineTransportError } from '../../common/errors/engine-transport.error';

/**
 * getProfilePicture answers `null` for a contact with no picture, for one whose privacy settings
 * hide it, and — until now — for a query that was never answered. That last one was confirmed live:
 * the route returned HTTP 200 {"url":null} after 60.03s.
 *
 * The catch here is load-bearing and must KEEP swallowing: a genuine "no picture" arrives as a
 * thrown error from the library. Only the deadline may pass through it.
 */
const never = (): Promise<never> => new Promise<never>(() => undefined);

function contacts(sock: Record<string, jest.Mock>, budgetMs: number): BaileysContacts {
  const host = {
    ensureReady: () => undefined,
    getSocket: () => sock as unknown as WASocket,
    logger: { warn: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() },
    normalizedSelfJid: () => '628177@s.whatsapp.net',
    listContacts: () => [],
    findContact: () => null,
    resolvePhone: () => null,
    listChats: () => [],
    lastMessage: () => null,
    toEngineJid: (j: string) => j,
  } as unknown as BaileysContactsHost;
  return new BaileysContacts(host, budgetMs);
}

describe('getProfilePicture', () => {
  it('reports an unanswered lookup instead of "no picture"', async () => {
    await expect(
      contacts({ profilePictureUrl: jest.fn(never) }, 15).getProfilePicture('628123@c.us'),
    ).rejects.toBeInstanceOf(EngineTransportError);
  });

  it('still answers null when the library reports no picture', async () => {
    // assertNodeErrorFree's verdict: a Boom carrying WhatsApp's numeric code.
    const profilePictureUrl = jest.fn().mockRejectedValue(new Boom('item-not-found', { data: 404 }));
    await expect(contacts({ profilePictureUrl }, 500).getProfilePicture('628123@c.us')).resolves.toBeNull();
  });

  it('reports a rate-limited lookup instead of "no picture"', async () => {
    const profilePictureUrl = jest.fn().mockRejectedValue(new Boom('rate-overlimit', { data: 429 }));
    await expect(contacts({ profilePictureUrl }, 500).getProfilePicture('628123@c.us')).rejects.toBeInstanceOf(
      EngineTransportError,
    );
  });

  it.each([
    ['internal-server-error', 500],
    ['service-unavailable', 503],
  ])('reports a WhatsApp server error (%s) instead of "no picture"', async (text, code) => {
    const profilePictureUrl = jest.fn().mockRejectedValue(new Boom(text, { data: code }));
    await expect(contacts({ profilePictureUrl }, 500).getProfilePicture('628123@c.us')).rejects.toBeInstanceOf(
      EngineTransportError,
    );
  });

  it('reports a connection that closed mid-lookup instead of "no picture"', async () => {
    const profilePictureUrl = jest.fn().mockRejectedValue(new Boom('Connection Closed', { statusCode: 428 }));
    await expect(contacts({ profilePictureUrl }, 500).getProfilePicture('628123@c.us')).rejects.toBeInstanceOf(
      EngineTransportError,
    );
  });

  it('still answers null when the library resolves nothing', async () => {
    const profilePictureUrl = jest.fn().mockResolvedValue(undefined);
    await expect(contacts({ profilePictureUrl }, 500).getProfilePicture('628123@c.us')).resolves.toBeNull();
  });

  it('still returns the url', async () => {
    const profilePictureUrl = jest.fn().mockResolvedValue('https://pps.whatsapp.net/x.jpg');
    await expect(contacts({ profilePictureUrl }, 500).getProfilePicture('628123@c.us')).resolves.toBe(
      'https://pps.whatsapp.net/x.jpg',
    );
  });
});
