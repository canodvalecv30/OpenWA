import { BufferJSON as stub } from '@whiskeysockets/baileys';

/**
 * `package.json`'s `jest.moduleNameMapper` redirects the whole `@whiskeysockets/baileys` package to a
 * hand-written stub, so the one test that named the message-store BufferJSON round-trip exercised the
 * stub — and its fixture carried no binary field, so the assertions held under ANY replacer/reviver
 * pair, including identity. A regression in that serialization could not fail CI.
 *
 * Real WAMessages carry binary fields (mediaKey, fileEncSha256, message secrets), and
 * baileys_stored_messages rows are what reply/forward/react/delete-by-id resolve against, so the
 * round-trip has to hold for BYTES, not just strings.
 *
 * The real library cannot be loaded here to compare against: it is ESM and jest cannot parse it,
 * which is why the stub exists at all. The wire form below is therefore pinned as a recorded value,
 * measured from the real `BufferJSON.replacer` outside jest. It cannot catch an upstream change on
 * its own — that is what `npm run check:versions` and a dependency bump review are for — but it does
 * stop the STUB drifting away from the shape the app actually persists.
 */
describe('the BufferJSON stub encodes bytes the way the library does', () => {
  const fixture = () => ({
    key: { id: 'M1', remoteJid: '1@s.whatsapp.net', fromMe: false },
    message: { conversation: 'hello' },
    mediaKey: Buffer.from([0x01, 0x02, 0x03, 0xff]),
    fileEncSha256: Buffer.from('deadbeef', 'hex'),
  });

  it('emits the recorded wire form for a Buffer', () => {
    // Measured from the real @whiskeysockets/baileys BufferJSON.replacer:
    //   JSON.stringify({ b: Buffer.from([1,2,3]) }, BufferJSON.replacer)
    //     === '{"b":{"type":"Buffer","data":"AQID"}}'
    expect(JSON.stringify({ b: Buffer.from([1, 2, 3]) }, stub.replacer)).toBe('{"b":{"type":"Buffer","data":"AQID"}}');
  });

  it('restores binary fields as Buffers, not as their JSON shape', () => {
    const encoded = JSON.stringify(fixture(), stub.replacer);
    const back = JSON.parse(encoded, stub.reviver) as { mediaKey: unknown; fileEncSha256: unknown };

    expect(Buffer.isBuffer(back.mediaKey)).toBe(true);
    expect(back.mediaKey).toEqual(Buffer.from([0x01, 0x02, 0x03, 0xff]));
    expect(Buffer.isBuffer(back.fileEncSha256)).toBe(true);
    expect(back.fileEncSha256).toEqual(Buffer.from('deadbeef', 'hex'));
  });

  it('revives only the shapes the library revives', () => {
    // Measured from the real @whiskeysockets/baileys 7.0.0-rc14 BufferJSON.reviver: a numeric-key
    // object of numbers becomes a Buffer, while array-form data and the old `{ buffer, value }`
    // shape come back untouched.
    const revive = (json: string): unknown => (JSON.parse(json, stub.reviver) as { a: unknown }).a;

    expect(revive('{"a":{"0":1,"1":2}}')).toEqual(Buffer.from([1, 2]));
    expect(revive('{"a":{"type":"Buffer","data":[1,2,3]}}')).toEqual({ type: 'Buffer', data: [1, 2, 3] });
    expect(revive('{"a":{"buffer":true,"value":"AQID"}}')).toEqual({ buffer: true, value: 'AQID' });
  });

  // The discriminating check: an identity codec — the thing the old fixture could not tell apart
  // from a working one — must fail this.
  it('fails for an identity codec, so the assertion is not vacuous', () => {
    const identity = { replacer: (_k: string, v: unknown) => v, reviver: (_k: string, v: unknown) => v };
    const back = JSON.parse(JSON.stringify(fixture(), identity.replacer), identity.reviver) as {
      mediaKey: unknown;
    };

    expect(Buffer.isBuffer(back.mediaKey)).toBe(false);
  });
});
