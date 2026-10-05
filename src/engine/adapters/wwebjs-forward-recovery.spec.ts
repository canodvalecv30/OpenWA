import type { Client } from 'whatsapp-web.js';
import { WwebjsMessaging } from './wwebjs-messaging';
import { createLogger } from '../../common/services/logger.service';
import { type WwebjsEngineHost } from './wwebjs-host';

/**
 * forwardMessage recovers the copy's id by diffing the destination chat's loaded own messages before
 * and after the send. Those reads take no limit, so they return everything WhatsApp Web holds, and a
 * concurrent call on the same chat (a history read, a reply) can page older messages in between the
 * two reads. Those arrive older than anything the first read saw and must not count as new.
 */
const logger = createLogger('wwebjs-forward-recovery.spec');

const row = (id: string, timestamp: number, isForwarded = false) => ({
  id: { _serialized: id },
  timestamp,
  isForwarded,
});

async function forwardWith(beforeRows: unknown[], afterRows: unknown[]): Promise<string> {
  const forward = jest.fn().mockResolvedValue(undefined);
  const sourceChat = { fetchMessages: jest.fn().mockResolvedValue([{ id: { _serialized: 'SRC1' }, forward }]) };
  const destChat = { fetchMessages: jest.fn().mockResolvedValueOnce(beforeRows).mockResolvedValueOnce(afterRows) };
  const client = {
    getChatById: jest.fn((id: string) => Promise.resolve(id === 'dest@c.us' ? destChat : sourceChat)),
  };
  const host = {
    ensureReady: jest.fn(),
    ensureNotChannelRecipient: jest.fn(),
    getClient: () => client as unknown as Client,
    getNumberId: jest.fn().mockResolvedValue(undefined),
    isPageTransportError: () => false,
    reportIfPageTransportError: jest.fn(),
    config: {},
    logger,
  } as unknown as WwebjsEngineHost;
  const result = await new WwebjsMessaging(host).forwardMessage('src@c.us', 'dest@c.us', 'SRC1');
  expect(forward).toHaveBeenCalledWith('dest@c.us');
  return result.id;
}

describe('WwebjsMessaging.forwardMessage id recovery with history paged in meanwhile', () => {
  // Returning OLD here would write another message's id onto the forward's row.
  it('does not take an older forwarded message for the copy', async () => {
    expect(await forwardWith([row('TEXT', 1000)], [row('OLD', 500, true), row('TEXT', 1000), row('FWD', 1000)])).toBe(
      'FWD',
    );
  });

  it('still identifies the copy when older own messages were paged in', async () => {
    expect(
      await forwardWith(
        [row('TEXT', 1000)],
        [row('OLD1', 400, true), row('OLD2', 500), row('TEXT', 1000), row('FWD', 1001, true)],
      ),
    ).toBe('FWD');
  });
});
