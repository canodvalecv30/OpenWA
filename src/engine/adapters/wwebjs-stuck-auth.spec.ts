import * as fs from 'fs';
import { WwebjsStuckAuth, type WwebjsStuckAuthHost } from './wwebjs-stuck-auth';
import { EngineStatus } from '../interfaces/whatsapp-engine.interface';
import { createLogger } from '../../common/services/logger.service';

/**
 * The stuck-auth recovery removes the session's LocalAuth profile. A stop and start arriving while
 * that rm is still walking the tree would launch a new Chromium into the directory being deleted,
 * so the rm must be registered with the credential-teardown fence before it is awaited, exactly as
 * the logout path registers its own removal.
 */
describe('WwebjsStuckAuth.recoverFromStuckAuth', () => {
  afterEach(() => jest.restoreAllMocks());

  it('registers the profile removal with the teardown fence while it is still running', async () => {
    let finishRm!: () => void;
    jest.spyOn(fs.promises, 'rm').mockReturnValue(new Promise<void>(resolve => (finishRm = resolve)));
    const registered: Promise<void>[] = [];
    const setStatus = jest.fn();
    const host: WwebjsStuckAuthHost = {
      logger: createLogger('wwebjs-stuck-auth.spec'),
      config: { sessionId: 's1', sessionDataPath: './data/sessions', puppeteer: {} },
      getClient: () => null,
      setClient: jest.fn(),
      setStatus,
      getCallbacks: () => ({
        claimStuckAuthRecovery: () => true,
        onCredentialTeardownStarted: (operation: Promise<void>) => registered.push(operation),
      }),
    };

    const recovery = new WwebjsStuckAuth(host).recoverFromStuckAuth();
    await Promise.resolve();

    expect(registered).toHaveLength(1);
    let settled = false;
    void registered[0].then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);

    finishRm();
    await recovery;
    expect(settled).toBe(true);
    expect(setStatus).toHaveBeenCalledWith(EngineStatus.DISCONNECTED);
  });
});
