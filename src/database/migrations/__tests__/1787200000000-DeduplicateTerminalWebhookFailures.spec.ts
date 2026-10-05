import { DataSource } from 'typeorm';
import { DeduplicateTerminalWebhookFailures1787200000000 } from '../1787200000000-DeduplicateTerminalWebhookFailures';

describe('terminal webhook failure identity migration', () => {
  it('preserves replay data while merging keyed duplicates and allows rollback', async () => {
    const ds = await new DataSource({ type: 'better-sqlite3', database: ':memory:' }).initialize();
    try {
      await ds.query(`CREATE TABLE webhook_delivery_failures (id text PRIMARY KEY, "webhookId" text,
        "idempotencyKey" text, attempts integer, payload text, "createdAt" text)`);
      await ds.query(`INSERT INTO webhook_delivery_failures VALUES
        ('a','w','k',5,NULL,'2026-10-05'), ('b','w','k',3,'{"body":"retained"}','2026-10-04'),
        ('c','w','k',0,NULL,'2026-10-03'), ('d','w',NULL,3,NULL,'2026-10-05'), ('e','w',NULL,3,NULL,'2026-10-05')`);
      const migration = new DeduplicateTerminalWebhookFailures1787200000000();
      const runner = ds.createQueryRunner();
      await migration.up(runner);
      await migration.up(runner);
      const rows = await ds.query<Array<{ id: string }>>('SELECT id FROM webhook_delivery_failures ORDER BY id');
      expect(rows.map(r => r.id)).toEqual(['b', 'c', 'd', 'e']);
      await expect(
        ds.query(`INSERT INTO webhook_delivery_failures VALUES ('f','w','k',1,NULL,'2026-10-05')`),
      ).rejects.toThrow();
      await migration.down(runner);
      await expect(
        ds.query(`INSERT INTO webhook_delivery_failures VALUES ('f','w','k',1,NULL,'2026-10-05')`),
      ).resolves.toBeDefined();
    } finally {
      await ds.destroy();
    }
  });
});
