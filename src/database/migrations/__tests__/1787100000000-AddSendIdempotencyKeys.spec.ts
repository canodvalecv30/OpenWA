import { DataSource } from 'typeorm';
import { AddSendIdempotencyKeys1787100000000 } from '../1787100000000-AddSendIdempotencyKeys';

describe('AddSendIdempotencyKeys migration', () => {
  let ds: DataSource;
  const migration = new AddSendIdempotencyKeys1787100000000();

  beforeEach(async () => {
    ds = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
    await ds.initialize();
  });

  afterEach(async () => {
    if (ds.isInitialized) await ds.destroy();
  });

  it('creates the table with both indexes', async () => {
    await migration.up(ds.createQueryRunner());

    const cols: { name: string }[] = await ds.query(`PRAGMA table_info("send_idempotency_keys")`);
    expect(cols.map(c => c.name).sort()).toEqual(
      [
        'createdAt',
        'expiresAt',
        'id',
        'idempotencyKey',
        'requestHash',
        'responseBody',
        'route',
        'sessionId',
        'state',
      ].sort(),
    );
    const indexes: { name: string }[] = await ds.query(`PRAGMA index_list("send_idempotency_keys")`);
    expect(indexes.map(i => i.name)).toContain('UQ_send_idempotency_keys_session_key');
    expect(indexes.map(i => i.name)).toContain('IDX_send_idempotency_keys_expiresAt');
  });

  it('refuses a second row for the same session and key, and allows it in another session', async () => {
    await migration.up(ds.createQueryRunner());
    const insert = (id: string, sessionId: string): Promise<unknown> =>
      ds.query(
        `INSERT INTO "send_idempotency_keys" ("id","sessionId","idempotencyKey","route","requestHash","state","expiresAt") ` +
          `VALUES ('${id}','${sessionId}','key-1','sendText','h','pending','2099-01-01T00:00:00.000Z')`,
      );

    await insert('row-1', 'sess-1');
    // The unique key IS the claim: a second insert must fail so only one request sends.
    await expect(insert('row-2', 'sess-1')).rejects.toThrow();
    await expect(insert('row-3', 'sess-2')).resolves.toBeDefined();
  });

  it('is a no-op when the table already exists, and reverts idempotently', async () => {
    await migration.up(ds.createQueryRunner());
    await expect(migration.up(ds.createQueryRunner())).resolves.toBeUndefined();

    await migration.down(ds.createQueryRunner());
    const tables: unknown[] = await ds.query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='send_idempotency_keys'`,
    );
    expect(tables).toHaveLength(0);
    await expect(migration.down(ds.createQueryRunner())).resolves.toBeUndefined();
  });
});
