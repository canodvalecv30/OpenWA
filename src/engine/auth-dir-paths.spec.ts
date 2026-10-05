import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { baileysAuthDir, readAuthDirEntries, wwjsAuthDir } from './auth-dir-paths';
import { BaileysAdapter } from './adapters/baileys.adapter';
import { WhatsAppWebJsAdapter } from './adapters/whatsapp-web-js.adapter';

// #1597: the engine auth directories are keyed by Session.id. Every writer of those paths has to
// agree, so each is asserted against the shared builders rather than a hand-written string.
describe('engine auth directory paths', () => {
  const SESSION_ID = '8f5b1d9e-0c4a-4e21-9d6b-2a7c3f0e1b44';

  it('the baileys adapter stores credentials at the id-keyed path', () => {
    const adapter = new BaileysAdapter({
      sessionId: SESSION_ID,
      dbSessionId: SESSION_ID,
      authDir: './data/baileys',
    });

    expect((adapter as unknown as { authPath: string }).authPath).toBe(baileysAuthDir('./data/baileys', SESSION_ID));
  });

  it('the whatsapp-web.js adapter removes the id-keyed LocalAuth profile', async () => {
    // force:true makes an unstubbed rm silent, so it is stubbed: the assertion is the path, not the
    // removal (covered in whatsapp-web-js.adapter.spec).
    const rm = jest.spyOn(fs.promises, 'rm').mockResolvedValue(undefined);
    try {
      const adapter = new WhatsAppWebJsAdapter({
        sessionId: SESSION_ID,
        sessionDataPath: './data/sessions',
        puppeteer: {},
      });

      await (adapter as unknown as { clearLocalAuth: () => Promise<void> }).clearLocalAuth.call(adapter);

      expect(rm).toHaveBeenCalledWith(wwjsAuthDir('./data/sessions', SESSION_ID), expect.anything());
    } finally {
      rm.mockRestore();
    }
  });

  it('resolves the whatsapp-web.js base but leaves the baileys one as configured, as the adapters do', () => {
    expect(wwjsAuthDir('./data/sessions', SESSION_ID)).toBe(
      path.join(path.resolve('./data/sessions'), `session-${SESSION_ID}`),
    );
    expect(baileysAuthDir('./data/baileys', SESSION_ID)).toBe(path.join('./data/baileys', SESSION_ID));
  });

  describe('readAuthDirEntries', () => {
    let tmpRoot: string;

    beforeEach(() => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-dir-entries-'));
    });
    afterEach(() => {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('lists directories and symlinked directories, not plain files', () => {
      fs.mkdirSync(path.join(tmpRoot, 'base', 'session-alice'), { recursive: true });
      fs.mkdirSync(path.join(tmpRoot, 'elsewhere', 'profile'), { recursive: true });
      fs.writeFileSync(path.join(tmpRoot, 'base', 'notes.txt'), 'x');
      // An operator who moved a large profile off the data volume: the link is what the adapter
      // opens, so it has to count as an auth directory.
      fs.symlinkSync(path.join(tmpRoot, 'elsewhere', 'profile'), path.join(tmpRoot, 'base', 'session-bob'));

      expect(readAuthDirEntries(path.join(tmpRoot, 'base'))).toEqual(new Set(['session-alice', 'session-bob']));
    });

    it('throws ENOENT for a missing base directory, so a caller can tell it from a failure', () => {
      expect(() => readAuthDirEntries(path.join(tmpRoot, 'absent'))).toThrow(/ENOENT/);
    });
  });
});
