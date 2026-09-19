import { evaluateFilters } from './filter-evaluator';
import { WebhookFilters } from './filter-types';

const msg = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  from: '111@c.us',
  to: '999@c.us',
  body: 'Hello World',
  type: 'text',
  fromMe: false,
  isGroup: false,
  ...over,
});

const filters = (...conditions: WebhookFilters['conditions']): WebhookFilters => ({ conditions });

describe('evaluateFilters', () => {
  it('passes when filters are absent or empty (additive/optional)', () => {
    expect(evaluateFilters(null, 'message.received', msg())).toBe(true);
    expect(evaluateFilters(undefined, 'message.received', msg())).toBe(true);
    expect(evaluateFilters(filters(), 'message.received', msg())).toBe(true);
  });

  it('matches sender by JID, case-insensitively', () => {
    const f = filters({ field: 'sender', operator: 'is', value: ['111@C.US'] });
    expect(evaluateFilters(f, 'message.received', msg())).toBe(true);
    expect(evaluateFilters(f, 'message.received', msg({ from: '222@c.us' }))).toBe(false);
  });

  it('matches a bare-digit phone filter against the engine JID across dialects (user-input canonicalization)', () => {
    // A user-typed phone (bare digits, optionally formatted) collapses to <digits>@c.us and matches the
    // sender whether the engine emitted @c.us or @s.whatsapp.net.
    const f = filters({ field: 'sender', operator: 'is', value: ['111'] });
    expect(evaluateFilters(f, 'message.received', msg({ from: '111@c.us' }))).toBe(true);
    expect(evaluateFilters(f, 'message.received', msg({ from: '111@s.whatsapp.net' }))).toBe(true);
    expect(evaluateFilters(f, 'message.received', msg({ from: '222@c.us' }))).toBe(false);

    // Formatting characters are stripped to digits before canonicalization.
    const formatted = filters({ field: 'sender', operator: 'is', value: ['+1 (11)'] });
    expect(evaluateFilters(formatted, 'message.received', msg({ from: '111@c.us' }))).toBe(true);
  });

  it('resolves sender to author in group messages', () => {
    const f = filters({ field: 'sender', operator: 'is', value: ['part@c.us'] });
    const groupMsg = msg({ from: '120@g.us', author: 'part@c.us', isGroup: true });
    expect(evaluateFilters(f, 'message.received', groupMsg)).toBe(true);
  });

  it('supports isNot (negation), including unknown sender', () => {
    const f = filters({ field: 'sender', operator: 'isNot', value: ['111@c.us'] });
    expect(evaluateFilters(f, 'message.received', msg())).toBe(false);
    expect(evaluateFilters(f, 'message.received', msg({ from: '222@c.us' }))).toBe(true);
    expect(evaluateFilters(f, 'message.received', msg({ from: undefined }))).toBe(true);
  });

  it('ANDs all conditions', () => {
    const f = filters(
      { field: 'sender', operator: 'is', value: ['111@c.us'] },
      { field: 'type', operator: 'is', value: ['image'] },
    );
    expect(evaluateFilters(f, 'message.received', msg({ type: 'image' }))).toBe(true);
    expect(evaluateFilters(f, 'message.received', msg({ type: 'text' }))).toBe(false);
  });

  it('matches the poll type a webhook or automation rule may now name', () => {
    const f = filters({ field: 'type', operator: 'isNot', value: ['poll'] });
    expect(evaluateFilters(f, 'message.received', msg({ type: 'text' }))).toBe(true);
    expect(evaluateFilters(f, 'message.received', msg({ type: 'poll' }))).toBe(false);
  });

  it('body contains is case-insensitive by default and case-sensitive when set', () => {
    expect(
      evaluateFilters(filters({ field: 'body', operator: 'contains', value: 'hello' }), 'message.received', msg()),
    ).toBe(true);
    expect(
      evaluateFilters(
        filters({ field: 'body', operator: 'contains', value: 'hello', caseSensitive: true }),
        'message.received',
        msg(),
      ),
    ).toBe(false);
  });

  it('body equals is exact and case-insensitive by default', () => {
    expect(
      evaluateFilters(filters({ field: 'body', operator: 'equals', value: 'Hello World' }), 'message.received', msg()),
    ).toBe(true);
    expect(
      evaluateFilters(filters({ field: 'body', operator: 'equals', value: 'hello world' }), 'message.received', msg()),
    ).toBe(true);
    expect(
      evaluateFilters(filters({ field: 'body', operator: 'equals', value: 'Hello' }), 'message.received', msg()),
    ).toBe(false);
  });

  it('boolean fields (isGroup, fromMe, hasMedia)', () => {
    expect(
      evaluateFilters(
        filters({ field: 'isGroup', operator: 'is', value: true }),
        'message.received',
        msg({ isGroup: true }),
      ),
    ).toBe(true);
    expect(evaluateFilters(filters({ field: 'fromMe', operator: 'is', value: false }), 'message.received', msg())).toBe(
      true,
    );
    expect(
      evaluateFilters(filters({ field: 'hasMedia', operator: 'is', value: true }), 'message.received', msg()),
    ).toBe(false);
    expect(
      evaluateFilters(
        filters({ field: 'hasMedia', operator: 'is', value: true }),
        'message.received',
        msg({ media: { mimetype: 'image/png' } }),
      ),
    ).toBe(true);
  });

  it('applies message-family smart filters to the normalized message.edited payload', () => {
    const edit = msg({
      from: '120@g.us',
      author: 'part@c.us',
      body: 'Updated invoice',
      type: 'image',
      isGroup: true,
      hasMedia: true,
      mentionedIds: ['boss@c.us'],
    });
    const f = filters(
      { field: 'sender', operator: 'is', value: ['part@c.us'] },
      { field: 'body', operator: 'contains', value: 'invoice' },
      { field: 'type', operator: 'is', value: ['image'] },
      { field: 'hasMedia', operator: 'is', value: true },
      { field: 'mentions', operator: 'is', value: ['boss@c.us'] },
    );

    expect(evaluateFilters(f, 'message.edited', edit)).toBe(true);
    expect(evaluateFilters(f, 'message.edited', { ...edit, hasMedia: false })).toBe(false);
  });

  it('mentions (idArray) intersects', () => {
    const f = filters({ field: 'mentions', operator: 'is', value: ['boss@c.us'] });
    expect(evaluateFilters(f, 'message.received', msg({ mentionedIds: ['boss@c.us', 'x@c.us'] }))).toBe(true);
    expect(evaluateFilters(f, 'message.received', msg({ mentionedIds: ['x@c.us'] }))).toBe(false);
  });

  it('skips conditions whose field is not registered for the event family', () => {
    // A message-family field carried on a (future) session event is ignored, not failed.
    const f = filters({ field: 'sender', operator: 'is', value: ['nobody@c.us'] });
    expect(evaluateFilters(f, 'session.status', msg())).toBe(true);
  });

  // ── WaId-aware id matching (engine-neutral) ───────────────────────
  // Ids are compared by their neutral WaId key, so a contact matches regardless of the dialect the
  // engine emits and regardless of how the filter is written (bare digits or a JID).

  describe('engine-neutral id matching', () => {
    it('matches the same user across @c.us and @s.whatsapp.net', () => {
      const f = filters({ field: 'sender', operator: 'is', value: ['111@c.us'] });
      expect(evaluateFilters(f, 'message.received', msg({ from: '111@s.whatsapp.net' }))).toBe(true);
    });

    it('matches a JID filter against a bare-number actor and vice versa', () => {
      expect(
        evaluateFilters(
          filters({ field: 'sender', operator: 'is', value: ['111'] }),
          'message.received',
          msg({ from: '111@c.us' }),
        ),
      ).toBe(true);
    });

    it('ignores a :device suffix', () => {
      const f = filters({ field: 'sender', operator: 'is', value: ['111@c.us'] });
      expect(evaluateFilters(f, 'message.received', msg({ from: '111:12@s.whatsapp.net' }))).toBe(true);
    });

    it('resolves a lid actor to its phone via the resolver (the lid->phone table)', () => {
      // Group author arrives as an unresolved @lid; the resolver maps it to the phone the filter names.
      const resolve = (jid: string): string | null => (jid.startsWith('111@lid') ? '628999' : null);
      const f = filters({ field: 'sender', operator: 'is', value: ['628999'] });
      const data = msg({ from: '120@g.us', author: '111@lid', isGroup: true });
      expect(evaluateFilters(f, 'message.received', data, resolve)).toBe(true);
    });

    it('control: without a resolver the same lid actor does NOT match the phone filter', () => {
      const f = filters({ field: 'sender', operator: 'is', value: ['628999'] });
      const data = msg({ from: '120@g.us', author: '111@lid', isGroup: true });
      expect(evaluateFilters(f, 'message.received', data)).toBe(false);
    });

    it('resolves lid actors inside mentions (idArray) too', () => {
      const resolve = (jid: string): string | null => (jid.startsWith('111@lid') ? '628999' : null);
      const f = filters({ field: 'mentions', operator: 'is', value: ['628999'] });
      expect(evaluateFilters(f, 'message.received', msg({ mentionedIds: ['111@lid', 'x@c.us'] }), resolve)).toBe(true);
    });
  });

  describe('chatId (conversation scoping so a webhook can allowlist specific groups)', () => {
    it('matches an explicit chatId on the payload', () => {
      const f = filters({ field: 'chatId', operator: 'is', value: ['120@g.us'] });
      expect(evaluateFilters(f, 'message.received', msg({ chatId: '120@g.us', from: 'part@c.us' }))).toBe(true);
      expect(evaluateFilters(f, 'message.received', msg({ chatId: '999@g.us', from: 'part@c.us' }))).toBe(false);
    });

    // `from` is the sender on a DM and this session on an outbound message, so reading it as the
    // conversation would scope the filter to the wrong chat. A payload without chatId matches
    // nothing rather than guessing.
    it('does not read from as the conversation when chatId is absent', () => {
      const f = filters({ field: 'chatId', operator: 'is', value: ['120@g.us'] });
      expect(
        evaluateFilters(f, 'message.received', msg({ from: '120@g.us', author: 'part@c.us', isGroup: true })),
      ).toBe(false);
    });

    it('supports isNot and multi-value allowlists', () => {
      const allow = filters({ field: 'chatId', operator: 'is', value: ['120@g.us', '121@g.us'] });
      expect(evaluateFilters(allow, 'message.received', msg({ chatId: '121@g.us' }))).toBe(true);
      expect(evaluateFilters(allow, 'message.received', msg({ chatId: '999@g.us' }))).toBe(false);

      const deny = filters({ field: 'chatId', operator: 'isNot', value: ['120@g.us'] });
      expect(evaluateFilters(deny, 'message.received', msg({ chatId: '120@g.us' }))).toBe(false);
      expect(evaluateFilters(deny, 'message.received', msg({ chatId: '999@g.us' }))).toBe(true);
    });

    it('scopes message.revoked / edited payloads that only carry chatId', () => {
      const f = filters({ field: 'chatId', operator: 'is', value: ['120@g.us'] });
      expect(evaluateFilters(f, 'message.revoked', { chatId: '120@g.us' })).toBe(true);
      expect(evaluateFilters(f, 'message.edited', { chatId: '999@g.us', body: 'x' })).toBe(false);
    });
  });

  describe('kind (chat kind, so a channel can be singled out where isGroup cannot)', () => {
    // The reporter's case: a webhook subscribed to message.received also gets channel posts, and
    // isGroup=false cannot tell a channel from a 1:1 chat. `kind` rides the received payload.
    it('excludes channel traffic with isNot, and matches it with is', () => {
      const exclude = filters({ field: 'kind', operator: 'isNot', value: ['channel'] });
      expect(evaluateFilters(exclude, 'message.received', msg({ kind: 'channel' }))).toBe(false);
      expect(evaluateFilters(exclude, 'message.received', msg({ kind: 'individual' }))).toBe(true);

      const only = filters({ field: 'kind', operator: 'is', value: ['channel'] });
      expect(evaluateFilters(only, 'message.received', msg({ kind: 'channel' }))).toBe(true);
      expect(evaluateFilters(only, 'message.received', msg({ kind: 'group' }))).toBe(false);
    });

    // The edited/reaction/revoked events in the family carry chatId but no kind, so it is derived.
    it('derives the kind from chatId when the payload omits it (edited/reaction/revoked)', () => {
      const f = filters({ field: 'kind', operator: 'is', value: ['channel'] });
      const revoked = { chatId: '120363000000000000@newsletter' } as Record<string, unknown>;
      expect(evaluateFilters(f, 'message.revoked', revoked)).toBe(true);
      const dm = { chatId: '628123@c.us' } as Record<string, unknown>;
      expect(evaluateFilters(f, 'message.revoked', dm)).toBe(false);
    });
  });
});
