/**
 * Unit-test stub for @whiskeysockets/baileys (ESM-only package).
 * ts-jest runs in CommonJS mode; this stub prevents "Cannot use import statement outside a module"
 * when any source file importing baileys is pulled into the unit test graph.
 * The e2e boot gate uses jest.mock() inline instead (test/baileys-engine.e2e-spec.ts).
 *
 * Note: the jest moduleNameMapper also redirects the `@whiskeysockets/baileys/(.*)` subpath
 * (including `/package.json`) to this stub, so BaileysPlugin.getEngineLibrary() returns an
 * undefined version in unit tests by design. Production reads the real package.json via the
 * unmapped require.
 */
export default jest.fn();
export const useMultiFileAuthState = jest.fn();
export const fetchLatestBaileysVersion = jest.fn();
export const getContentType = jest.fn();
export const normalizeMessageContent = jest.fn((c: unknown) => c);
export const generateWAMessageFromContent = jest.fn();
export const DisconnectReason = { loggedOut: 401 };

/**
 * Protocol constants the adapter reads at RUNTIME (not just as types), mirrored from
 * WAProto/index.d.ts. Values are wire-format enum members, so they are fixed by the protocol
 * rather than by the library version — but keep them in step with the real proto if more are
 * added here.
 */
export const proto = {
  // namespace proto.PinInChat { enum Type } — WAProto/index.d.ts:10355-10361
  PinInChat: { Type: { UNKNOWN_TYPE: 0, PIN_FOR_ALL: 1, UNPIN_FOR_ALL: 2 } },
};

// Inline implementation mirrored from @whiskeysockets/baileys/lib/Utils/generics.js
// (the package is pure ESM; ts-jest runs CJS, so the mock owns the serialisation helpers)

type BufferLike = { type: 'Buffer'; data: string | number[] };
type BufferJsonObject = { type?: string; data?: unknown };

export const BufferJSON = {
  replacer: (_k: string, value: unknown): unknown => {
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
      return { type: 'Buffer', data: Buffer.from(value).toString('base64') };
    }
    if (typeof value === 'object' && value !== null && (value as BufferLike).type === 'Buffer') {
      return { type: 'Buffer', data: Buffer.from((value as BufferLike).data).toString('base64') };
    }
    return value;
  },
  reviver: (_: string, value: unknown): unknown => {
    if (typeof value === 'object' && value !== null) {
      const obj = value as BufferJsonObject;
      if (obj.type === 'Buffer' && typeof obj.data === 'string') {
        return Buffer.from(obj.data, 'base64');
      }
      if (!Array.isArray(value)) {
        const keys = Object.keys(value);
        if (keys.length > 0 && keys.every(k => !isNaN(parseInt(k, 10)))) {
          const values = Object.values(value);
          if (values.every(v => typeof v === 'number')) {
            return Buffer.from(values);
          }
        }
      }
    }
    return value;
  },
};
