import { Module, DynamicModule, Type } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Webhook } from './entities/webhook.entity';
import { WebhookDeliveryFailure } from './entities/webhook-delivery-failure.entity';
import { WebhookOutboxEvent } from './entities/webhook-outbox-event.entity';
import { WebhookOutboxService } from './webhook-outbox.service';
import { WebhookReconcilerService } from './webhook-reconciler.service';
import { Session } from '../session/entities/session.entity';
import { WebhookService } from './webhook.service';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { WebhookRedriveService } from './webhook-redrive.service';
import { WebhookController } from './webhook.controller';
import { WebhooksListController } from './webhooks-list.controller';
import { EngineModule } from '../../engine/engine.module';

// Only import QueueModule if explicitly enabled to avoid Redis connection errors
const queueModules: Array<Type | DynamicModule> = [];
if (process.env.QUEUE_ENABLED === 'true') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const queueModule = require('../queue/queue.module') as {
    QueueModule: Type;
  };
  queueModules.push(queueModule.QueueModule);
}

@Module({
  imports: [
    TypeOrmModule.forFeature([Webhook, WebhookDeliveryFailure, WebhookOutboxEvent, Session], 'data'),
    EngineModule,
    ...queueModules,
  ],
  controllers: [WebhookController, WebhooksListController],
  providers: [
    WebhookService,
    WebhookDeliveryService,
    WebhookOutboxService,
    WebhookReconcilerService,
    WebhookRedriveService,
  ],
  exports: [WebhookService],
})
export class WebhookModule {}
