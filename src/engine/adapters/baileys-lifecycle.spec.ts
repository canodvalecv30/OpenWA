jest.mock('@whiskeysockets/baileys', () => ({ __esModule: true, initAuthCreds: jest.fn() }));
jest.mock('./baileys-auth-store', () => ({
  useAtomicMultiFileAuthState: jest.fn().mockRejectedValue(new Error('stop after auth load')),
}));

import * as BaileysLib from '@whiskeysockets/baileys';
import { useAtomicMultiFileAuthState } from './baileys-auth-store';
import { BaileysLifecycle, type BaileysLifecycleHost } from './baileys-lifecycle';

describe('BaileysLifecycle.connect', () => {
  it('loads the auth state through the atomic store with the session auth dir, library and logger', async () => {
    const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const noCallback = (): undefined => undefined;
    const host = {
      authPath: '/data/baileys/session-sess-1',
      logger,
      config: { sessionId: 'sess-1' },
      getOnStateChanged: noCallback,
      getOnError: noCallback,
    } as unknown as BaileysLifecycleHost;

    await expect(new BaileysLifecycle(host).initialize()).rejects.toThrow('stop after auth load');

    expect(useAtomicMultiFileAuthState).toHaveBeenCalledTimes(1);
    const [folder, lib, authLogger] = jest.mocked(useAtomicMultiFileAuthState).mock.calls[0];
    expect(folder).toBe(host.authPath);
    expect(lib.initAuthCreds).toBe(BaileysLib.initAuthCreds);
    expect(authLogger).toBe(logger);
  });
});

describe('BaileysLifecycle unlink cleanup', () => {
  function lifecycle() {
    const noCallback = (): undefined => undefined;
    const fenceStoredWrites = jest.fn();
    const messageStore = { clearSession: jest.fn().mockResolvedValue(undefined) };
    const host = {
      authPath: '/nonexistent/openwa-lifecycle-spec/session-sess-1',
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
      config: { sessionId: 'sess-1', dbSessionId: 'db-1', messageStore },
      liveCalls: new Map(),
      fenceStoredWrites,
      getOnStateChanged: noCallback,
      getOnDisconnected: noCallback,
      getOnError: noCallback,
      getOnCredentialTeardownStarted: noCallback,
    } as unknown as BaileysLifecycleHost;
    const sock = {
      user: { id: '628999:1@s.whatsapp.net' },
      query: jest.fn().mockResolvedValue({ tag: 'iq' }),
      generateMessageTag: () => 'tag-1',
      end: jest.fn(),
    };
    const engine = new BaileysLifecycle(host);
    engine.sock = sock as unknown as BaileysLifecycle['sock'];
    return { engine, fenceStoredWrites, clearSession: messageStore.clearSession };
  }

  // A message still being processed must not recreate a row of the unlinked account after its store
  // is wiped, so the store writes are fenced first.
  it('fences stored writes before wiping the message store on an API logout', async () => {
    const { engine, fenceStoredWrites, clearSession } = lifecycle();
    await engine.logout();
    expect(clearSession).toHaveBeenCalledWith('db-1');
    expect(fenceStoredWrites).toHaveBeenCalledTimes(1);
    expect(fenceStoredWrites.mock.invocationCallOrder[0]).toBeLessThan(clearSession.mock.invocationCallOrder[0]);
  });

  it('fences stored writes before wiping the message store on a WhatsApp-side logout', async () => {
    const { engine, fenceStoredWrites, clearSession } = lifecycle();
    await (engine as unknown as { handleRemoteLoggedOut(): Promise<void> }).handleRemoteLoggedOut();
    expect(clearSession).toHaveBeenCalledWith('db-1');
    expect(fenceStoredWrites).toHaveBeenCalledTimes(1);
    expect(fenceStoredWrites.mock.invocationCallOrder[0]).toBeLessThan(clearSession.mock.invocationCallOrder[0]);
  });
});
