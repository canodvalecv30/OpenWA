import { MigrationInterface, QueryRunner } from 'typeorm';

/** Keep one terminal record per receiver deduplication identity. */
export class DeduplicateTerminalWebhookFailures1787200000000 implements MigrationInterface {
  name = 'DeduplicateTerminalWebhookFailures1787200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.dataSource.options.type === 'postgres') await queryRunner.query('SET LOCAL statement_timeout = 0');
    // Prefer a replay copy, then the largest attempt count and most recent record.
    // Unkeyed failures have no shared identity and remain separate.
    await queryRunner.query(`DELETE FROM "webhook_delivery_failures" WHERE "id" IN (
      SELECT "id" FROM (
        SELECT "id", ROW_NUMBER() OVER (
          PARTITION BY "webhookId", "idempotencyKey"
          ORDER BY CASE WHEN "payload" IS NOT NULL THEN 0 ELSE 1 END,
            "attempts" DESC, "createdAt" DESC, "id" DESC
        ) AS ordinal FROM "webhook_delivery_failures"
        WHERE "attempts" > 0 AND "idempotencyKey" IS NOT NULL
      ) AS ranked WHERE ordinal > 1
    )`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_webhook_delivery_failures_terminal"
      ON "webhook_delivery_failures" ("webhookId", "idempotencyKey") WHERE "attempts" > 0`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "UQ_webhook_delivery_failures_terminal"');
  }
}
