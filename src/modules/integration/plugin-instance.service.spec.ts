import { DataSource } from 'typeorm';
import { PluginInstance } from './entities/plugin-instance.entity';
import { PluginInstanceService, InstanceExistsError } from './plugin-instance.service';
import { AddIntegrationFabric1781900000000 } from '../../database/migrations/1781900000000-AddIntegrationFabric';
import type { PluginConfigSchema } from '../../core/plugins/plugin.interfaces';

describe('PluginInstanceService', () => {
  let ds: DataSource;
  let service: PluginInstanceService;
  beforeEach(async () => {
    ds = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [PluginInstance], migrations: [] });
    await ds.initialize();
    const runner = ds.createQueryRunner();
    await new AddIntegrationFabric1781900000000().up(runner);
    await runner.release();
    service = new PluginInstanceService(ds.getRepository(PluginInstance));
  });
  afterEach(async () => {
    if (ds.isInitialized) await ds.destroy();
  });

  it('mints a 64-hex-char secret and stores a composite id', async () => {
    const inst = await service.mint('chatwoot', 'acct1', { sessionScope: 'sess-1' });
    expect(inst.id).toBe('chatwoot:acct1');
    expect(inst.secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('masks the secret on the operator-facing view', async () => {
    const inst = await service.mint('chatwoot', 'acct1', {});
    expect(service.maskedView(inst).secret).toBe('***');
  });

  it('masks secret:true config fields (apiToken) on masked reads', () => {
    const schema = {
      type: 'object',
      properties: { apiToken: { type: 'string', secret: true }, accountId: { type: 'number' } },
    } as PluginConfigSchema;
    const inst = {
      id: 'p:i',
      secret: 'x',
      config: { apiToken: 'live-token', accountId: 3 },
    } as unknown as PluginInstance;
    const masked = service.maskedView(inst, schema);
    const config = masked.config as Record<string, unknown>;
    expect(masked.secret).toBe('***');
    expect(config.apiToken).toBe('***');
    expect(config.accountId).toBe(3);
  });

  it('masks the ENTIRE config when the schema is unavailable, e.g. the plugin is unloaded (fail-closed)', () => {
    const inst = {
      id: 'p:i',
      secret: 'x',
      config: { apiToken: 'live-token', accountId: 3 },
    } as unknown as PluginInstance;
    const config = service.maskedView(inst, undefined).config as Record<string, unknown>;
    expect(config.apiToken).toBe('***');
    expect(config.accountId).toBe('***');
  });

  it('resolves an existing instance and returns null for an unknown one', async () => {
    await service.mint('chatwoot', 'acct1', {});
    expect((await service.resolve('chatwoot', 'acct1'))?.id).toBe('chatwoot:acct1');
    expect(await service.resolve('chatwoot', 'nope')).toBeNull();
  });

  it('accepts a valid operator secret, rejects short/empty, else auto-generates', async () => {
    const ok = await service.create('chatwoot-adapter', 'a1', { secret: 'cw-secret-16chars!' });
    expect(ok.secret).toBe('cw-secret-16chars!');
    await expect(service.create('chatwoot-adapter', 'a2', { secret: '   ' })).rejects.toThrow(/secret/i);
    await expect(service.create('chatwoot-adapter', 'a3', { secret: 'short' })).rejects.toThrow(/16/);
    const gen = await service.create('chatwoot-adapter', 'a4', {});
    expect(gen.secret).toMatch(/^[0-9a-f]{64}$/);
  });

  // A GET challenge route answers 403 while verifyToken is null, and no update path can set it later.
  it('keeps a supplied verifyToken, else auto-generates one on create and mint', async () => {
    expect((await service.create('meta', 'a1', { verifyToken: 'hub-token' })).verifyToken).toBe('hub-token');
    expect((await service.create('meta', 'a2', {})).verifyToken).toMatch(/^[0-9a-f]{32}$/);
    expect((await service.mint('meta', 'a3', {})).verifyToken).toMatch(/^[0-9a-f]{32}$/);
  });

  it('masks a NESTED secret:true config field on masked reads (recursive redaction)', () => {
    const schema = {
      type: 'object',
      properties: {
        provider: {
          type: 'object',
          properties: { apiToken: { type: 'string', secret: true }, region: { type: 'string' } },
        },
      },
    } as PluginConfigSchema;
    const inst = {
      id: 'p:i',
      secret: 'x',
      config: { provider: { apiToken: 'live-token', region: 'us' } },
    } as unknown as PluginInstance;
    const config = service.maskedView(inst, schema).config as { provider: Record<string, unknown> };
    expect(config.provider.apiToken).toBe('***');
    expect(config.provider.region).toBe('us');
  });

  it('update restores a masked (sentinel) secret to the stored value instead of persisting "***"', async () => {
    const schema = {
      type: 'object',
      properties: { apiToken: { type: 'string', secret: true }, accountId: { type: 'number' } },
    } as PluginConfigSchema;
    await service.create('chatwoot', 'acct1', { config: { apiToken: 'real-token', accountId: 1 } });

    // Dashboard round-trips the masked config back with an edited non-secret field.
    const updated = await service.update('chatwoot', 'acct1', { config: { apiToken: '***', accountId: 2 } }, schema);

    expect(updated?.config).toEqual({ apiToken: 'real-token', accountId: 2 });
  });
});

describe('PluginInstanceService provisioning', () => {
  let ds: DataSource;
  let service: PluginInstanceService;
  beforeEach(async () => {
    ds = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [PluginInstance], migrations: [] });
    await ds.initialize();
    const runner = ds.createQueryRunner();
    await new AddIntegrationFabric1781900000000().up(runner);
    await runner.release();
    service = new PluginInstanceService(ds.getRepository(PluginInstance));
  });
  afterEach(async () => {
    if (ds.isInitialized) await ds.destroy();
  });

  it('create mints a new instance and rejects a duplicate with InstanceExistsError', async () => {
    const inst = await service.create('chatwoot', 'acct1', { sessionScope: 'sess-1' });
    expect(inst.id).toBe('chatwoot:acct1');
    expect(inst.secret).toMatch(/^[0-9a-f]{64}$/);
    await expect(service.create('chatwoot', 'acct1', {})).rejects.toBeInstanceOf(InstanceExistsError);
  });

  it('list returns all instances for a plugin', async () => {
    await service.create('chatwoot', 'acct1', {});
    await service.create('chatwoot', 'acct2', {});
    await service.create('other', 'x', {});
    const list = await service.list('chatwoot');
    expect(list.map(i => i.instanceId).sort()).toEqual(['acct1', 'acct2']);
  });

  it('regenerateSecret replaces the secret with a new value', async () => {
    const created = await service.create('chatwoot', 'acct1', {});
    const rotated = await service.regenerateSecret('chatwoot', 'acct1');
    expect(rotated?.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(rotated?.secret).not.toBe(created.secret);
  });

  it('update patches enabled/scope/config in one write; remove deletes', async () => {
    await service.create('chatwoot', 'acct1', { sessionScope: 'a' });
    const repo = ds.getRepository(PluginInstance);
    const write = jest.spyOn(repo, 'update');
    const save = jest.spyOn(repo, 'save');
    const patched = await service.update('chatwoot', 'acct1', { enabled: false, sessionScope: 'b', config: { k: 1 } });
    expect(write).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    expect(patched?.enabled).toBe(false);
    expect(patched?.sessionScope).toBe('b');
    expect(patched?.config).toEqual({ k: 1 });
    expect((await service.resolve('chatwoot', 'acct1'))?.enabled).toBe(false);
    expect(await service.remove('chatwoot', 'acct1')).toBe(true);
    expect(await service.resolve('chatwoot', 'acct1')).toBeNull();
    expect(await service.remove('chatwoot', 'acct1')).toBe(false);
  });

  it('update and regenerateSecret return the stored updatedAt, not the one read before the write', async () => {
    await service.create('chatwoot', 'acct1', {});
    const backdate = () => ds.query(`UPDATE plugin_instances SET "updatedAt" = '2000-01-01 00:00:00'`);

    await backdate();
    const patched = await service.update('chatwoot', 'acct1', { enabled: false });
    const afterPatch = await service.resolve('chatwoot', 'acct1');
    expect(afterPatch?.updatedAt.getUTCFullYear()).not.toBe(2000);
    expect(patched?.updatedAt).toEqual(afterPatch?.updatedAt);

    await backdate();
    const rotated = await service.regenerateSecret('chatwoot', 'acct1');
    const afterRotate = await service.resolve('chatwoot', 'acct1');
    expect(rotated?.updatedAt).toEqual(afterRotate?.updatedAt);
    expect(rotated?.secret).toBe(afterRotate?.secret);
  });

  it('answers a concurrent duplicate create with InstanceExistsError and keeps the first secret', async () => {
    const results = await Promise.allSettled([
      service.create('chatwoot', 'acct1', { secret: 'first-secret-16chars' }),
      service.create('chatwoot', 'acct1', { secret: 'second-secret-16chars' }),
    ]);
    const created = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    expect(created).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(InstanceExistsError);
    const winner = created[0].value;
    expect((await service.resolve('chatwoot', 'acct1'))?.secret).toBe(winner.secret);
  });

  it('mint returns the stored row when a concurrent mint inserted it first', async () => {
    const [a, b] = await Promise.all([service.mint('chatwoot', 'acct1', {}), service.mint('chatwoot', 'acct1', {})]);
    expect(a.secret).toBe(b.secret);
    expect((await service.resolve('chatwoot', 'acct1'))?.secret).toBe(a.secret);
  });

  // update() reads the row before it writes; a DELETE or a secret rotation can land in between.
  it('update does not re-insert a row deleted after it was read', async () => {
    await service.create('chatwoot', 'acct1', {});
    const stale = await service.resolve('chatwoot', 'acct1');
    await service.remove('chatwoot', 'acct1');
    jest.spyOn(service, 'resolve').mockResolvedValueOnce(stale);

    expect(await service.update('chatwoot', 'acct1', { enabled: false })).toBeNull();
    expect(await service.resolve('chatwoot', 'acct1')).toBeNull();
  });

  it('update does not revert a secret rotated after it was read', async () => {
    await service.create('chatwoot', 'acct1', {});
    const stale = await service.resolve('chatwoot', 'acct1');
    const rotated = await service.regenerateSecret('chatwoot', 'acct1');
    jest.spyOn(service, 'resolve').mockResolvedValueOnce(stale);

    await service.update('chatwoot', 'acct1', { enabled: false });

    const stored = await service.resolve('chatwoot', 'acct1');
    expect(stored?.secret).toBe(rotated?.secret);
    expect(stored?.enabled).toBe(false);
  });

  it('regenerateSecret answers null, without re-inserting, for a row deleted after it was read', async () => {
    await service.create('chatwoot', 'acct1', {});
    const stale = await service.resolve('chatwoot', 'acct1');
    await service.remove('chatwoot', 'acct1');
    jest.spyOn(service, 'resolve').mockResolvedValueOnce(stale);

    await expect(service.regenerateSecret('chatwoot', 'acct1')).resolves.toBeNull();
    expect(await service.resolve('chatwoot', 'acct1')).toBeNull();
  });

  it('normalizes an empty sessionScope to null (all-sessions) on mint/create/update, never a literal ""', async () => {
    // '' would break outbound send (falsy sessionId) and be unrecoverable from the UI; store null instead.
    const minted = await service.mint('chatwoot', 'm1', { sessionScope: '' });
    expect(minted.sessionScope).toBeNull();
    const created = await service.create('chatwoot', 'acct1', { sessionScope: '' });
    expect(created.sessionScope).toBeNull();
    const patched = await service.update('chatwoot', 'acct1', { sessionScope: '' });
    expect(patched?.sessionScope).toBeNull();
  });

  // PATCH sessionScope:null is how an operator returns a bound instance to all sessions. It must land
  // as the same null an unscoped create stores, since ingress and the sandbox bridge pass a stored
  // '*' on as a literal session id.
  it('update clears a bound sessionScope to null, the value an unscoped create stores', async () => {
    const unscoped = await service.create('chatwoot', 'acct0', {});
    await service.create('chatwoot', 'acct1', { sessionScope: 'sess-1' });

    const cleared = await service.update('chatwoot', 'acct1', { sessionScope: null });

    expect(cleared?.sessionScope).toBeNull();
    expect(unscoped.sessionScope).toBeNull();
    expect((await service.resolve('chatwoot', 'acct1'))?.sessionScope).toBeNull();
  });
});
