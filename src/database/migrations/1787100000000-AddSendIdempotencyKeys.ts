import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `send_idempotency_keys`, the claims behind the opt-in `Idempotency-Key` header on the send
 * routes (SendIdempotencyInterceptor). UNIQUE(sessionId, idempotencyKey) is the claim itself: the
 * insert that wins it runs the send, so the guarantee holds across nodes sharing the database.
 *
 * Hand-authored because `synchronize` is off on the `data` connection for Postgres; the `hasTable`
 * guard keeps it idempotent on a database where synchronize already created the table. The DDL
 * matches what synchronize emits from the entity, so the migration-drift gate sees no difference:
 * `responseBody` is `text` on both dialects (jsonColumnType() is 'simple-json'), `expiresAt` is
 * dateColumnType() ('text' on SQLite) and `createdAt` a plain @CreateDateColumn ('datetime' there).
 */
export class AddSendIdempotencyKeys1787100000000 implements MigrationInterface {
  name = 'AddSendIdempotencyKeys1787100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('send_idempotency_keys')) return;
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const id = isPostgres
      ? `"id" varchar PRIMARY KEY NOT NULL DEFAULT gen_random_uuid()::varchar`
      : `"id" varchar PRIMARY KEY NOT NULL`;
    const expiresTs = isPostgres ? 'timestamp' : 'text';
    const createdTs = isPostgres ? 'timestamp' : 'datetime';
    const now = isPostgres ? 'NOW()' : `(datetime('now'))`;

    await queryRunner.query(
      `CREATE TABLE "send_idempotency_keys" (${id}, "sessionId" varchar NOT NULL, ` +
        `"idempotencyKey" varchar NOT NULL, "route" varchar NOT NULL, "requestHash" varchar NOT NULL, ` +
        `"state" varchar NOT NULL, "responseBody" text, "expiresAt" ${expiresTs} NOT NULL, ` +
        `"createdAt" ${createdTs} NOT NULL DEFAULT ${now})`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_send_idempotency_keys_session_key" ON "send_idempotency_keys" ("sessionId", "idempotencyKey")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_send_idempotency_keys_expiresAt" ON "send_idempotency_keys" ("expiresAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // IF EXISTS so revert is idempotent on a synchronize-bootstrapped DB, where up() took the
    // hasTable early return and the named indexes were never created.
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_send_idempotency_keys_expiresAt"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_send_idempotency_keys_session_key"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "send_idempotency_keys"`);
  }
}
