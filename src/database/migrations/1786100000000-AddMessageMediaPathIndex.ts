import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Partial index on `messages.mediaPath`, backing the chat-media orphan sweep's per-chunk
 * `WHERE mediaPath IN (...)` lookup (chat-media-archive.service.ts). The column is NULL for every
 * row while archiving is off (the default) and for every un-archived message, so a full index over
 * it would mostly index NULLs; the `WHERE mediaPath IS NOT NULL` partial form keeps it to the
 * archived rows that can ever match, on both SQLite and Postgres.
 *
 * Same reasoning as AddMessagesCreatedAtIndex: hand-authored because `synchronize` is off for the
 * data connection on PostgreSQL (and optional on SQLite). The explicit name matches the entity's
 * @Index, so the synchronize and migration schema paths converge on one index. Idempotent via
 * IF NOT EXISTS (supported by both dialects for indexes).
 */
export class AddMessageMediaPathIndex1786100000000 implements MigrationInterface {
  name = 'AddMessageMediaPathIndex1786100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Boot and CLI migrations run on a pool without the runtime statement_timeout (pg-boot-migrations.ts),
    // and MigrationExecutor wraps a lone pending migration in its own transaction, so lift any role- or
    // database-level default for this transaction only, exactly like AddMessagesCreatedAtIndex.
    if (queryRunner.dataSource.options.type === 'postgres') {
      await queryRunner.query('SET LOCAL statement_timeout = 0');
    }
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_messages_mediaPath" ON "messages" ("mediaPath") WHERE "mediaPath" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_messages_mediaPath"`);
  }
}
