/**
 * Unit-test stub for `https-proxy-agent` (ESM-only since v8). ts-jest runs in CommonJS mode, so any
 * source file that imports it — directly (baileys-lifecycle) or transitively (anything that pulls in
 * the engine adapters) — fails to load without this stub once the package lands in the unit test
 * graph. The unit suites never open a real proxied socket, so a class that records the proxy URL and
 * satisfies the `Agent` return type of createProxyAgent is sufficient — and because the spec's
 * `instanceof` checks import the same mapped module, they run against this very class. Jest applies
 * this stub in the e2e lane too (test/ is that config's rootDir), so a suite gets the real module only
 * by calling jest.unmock('https-proxy-agent'), as baileys-proxy-agent.e2e-spec.ts does.
 */
import { Agent } from 'node:https';

export class HttpsProxyAgent extends Agent {
  readonly proxy: string;

  constructor(proxy: string | URL) {
    super();
    this.proxy = String(proxy);
  }
}
