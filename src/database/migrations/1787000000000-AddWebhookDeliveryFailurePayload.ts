import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `webhook_delivery_failures.payload`: the event data a terminal delivery failure was built
 * from, kept for WEBHOOK_FAILURE_PAYLOAD_RETENTION_HOURS so `POST /webhooks/delivery-failures/redrive`
 * can replay it. `text` on both dialects, the storage the entity's `simple-json` maps to (see
 * jsonColumnType). NULL for every existing row, so nothing recorded before the upgrade is replayable,
 * which keeps today's behaviour. Hand-authored because `synchronize` is off on the `data` connection
 * for Postgres.
 */
export class AddWebhookDeliveryFailurePayload1787000000000 implements MigrationInterface {
  name = 'AddWebhookDeliveryFailurePayload1787000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('webhook_delivery_failures', 'payload')) return;
    await queryRunner.query(`ALTER TABLE "webhook_delivery_failures" ADD COLUMN "payload" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('webhook_delivery_failures', 'payload'))) return;
    await queryRunner.query(`ALTER TABLE "webhook_delivery_failures" DROP COLUMN "payload"`);
  }
}
