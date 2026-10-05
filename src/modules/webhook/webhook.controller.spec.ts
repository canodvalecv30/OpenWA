import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { WebhookController } from './webhook.controller';
import { WebhooksListController } from './webhooks-list.controller';
import { WebhookService } from './webhook.service';
import { Webhook } from './entities/webhook.entity';
import { Session } from '../session/entities/session.entity';
import { REQUIRED_ROLE_KEY } from '../auth/decorators/auth.decorators';
import { ApiKey, ApiKeyRole } from '../auth/entities/api-key.entity';
import { WebhookRedriveService } from './webhook-redrive.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/entities/audit-log.entity';

/**
 * Regression locks for the secret/headers leak and read authorization at the controller level.
 */

function createSecretWebhook(overrides: Partial<Webhook> = {}): Webhook {
  return {
    id: 'wh-uuid-1',
    sessionId: 'sess-1',
    url: 'https://example.com/webhook',
    events: ['message.received'],
    secret: 's3cr3t-hmac-key',
    headers: { Authorization: 'Bearer receiver-token' },
    filters: null,
    active: true,
    retryCount: 3,
    lastTriggeredAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    session: undefined as unknown as Session,
    ...overrides,
  };
}

describe('Webhook controllers (secret leak + read authz)', () => {
  let controller: WebhookController;
  let listController: WebhooksListController;
  let reflector: Reflector;
  let service: jest.Mocked<Partial<WebhookService>>;
  let redrive: { redrive: jest.Mock };
  let audit: { logInfo: jest.Mock };

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      findBySession: jest.fn(),
      findOne: jest.fn(),
      findAll: jest.fn(),
      update: jest.fn(),
    };

    redrive = { redrive: jest.fn() };
    audit = { logInfo: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhookController, WebhooksListController],
      providers: [
        { provide: WebhookService, useValue: service },
        { provide: WebhookRedriveService, useValue: redrive },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    controller = module.get<WebhookController>(WebhookController);
    listController = module.get<WebhooksListController>(WebhooksListController);
    reflector = new Reflector();
  });

  // ── secret/headers must never appear in any response body ──────

  it('findOne does not return secret or headers, but keeps safe fields', async () => {
    (service.findOne as jest.Mock).mockResolvedValue(createSecretWebhook());

    const result = await controller.findOne('sess-1', 'wh-uuid-1');

    expect(result).not.toHaveProperty('secret');
    expect(result).not.toHaveProperty('headers');
    expect(JSON.stringify(result)).not.toContain('s3cr3t');
    expect(result.id).toBe('wh-uuid-1');
    expect(result.url).toBe('https://example.com/webhook');
    expect(result.events).toEqual(['message.received']);
    expect(result.active).toBe(true);
  });

  it('findBySession strips secret/headers from every item', async () => {
    (service.findBySession as jest.Mock).mockResolvedValue([
      createSecretWebhook(),
      createSecretWebhook({ id: 'wh-2' }),
    ]);

    const result = await controller.findBySession('sess-1');

    expect(result).toHaveLength(2);
    for (const w of result) {
      expect(w).not.toHaveProperty('secret');
      expect(w).not.toHaveProperty('headers');
    }
    expect(JSON.stringify(result)).not.toContain('s3cr3t');
  });

  it('cross-session findAll strips secret/headers', async () => {
    (service.findAll as jest.Mock).mockResolvedValue([createSecretWebhook()]);

    const result = await listController.findAll();

    expect(result[0]).not.toHaveProperty('secret');
    expect(result[0]).not.toHaveProperty('headers');
    expect(JSON.stringify(result)).not.toContain('Bearer receiver-token');
  });

  it('create response echoes no secret/headers', async () => {
    (service.create as jest.Mock).mockResolvedValue(createSecretWebhook());

    const result = await controller.create('sess-1', { url: 'https://example.com/webhook', secret: 's3cr3t-hmac-key' });

    expect(result).not.toHaveProperty('secret');
    expect(result).not.toHaveProperty('headers');
    expect(result.id).toBe('wh-uuid-1');
  });

  it('update response returns no secret/headers', async () => {
    (service.update as jest.Mock).mockResolvedValue(createSecretWebhook({ url: 'https://new.example.com/hook' }));

    const result = await controller.update('sess-1', 'wh-uuid-1', { url: 'https://new.example.com/hook' });

    expect(result).not.toHaveProperty('secret');
    expect(result).not.toHaveProperty('headers');
    expect(result.url).toBe('https://new.example.com/hook');
  });

  // ── read routes require OPERATOR+ (VIEWER → 403 via guard) ─────

  it('findBySession requires OPERATOR role', () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- reading route metadata, not invoking
    const role = reflector.get<ApiKeyRole>(REQUIRED_ROLE_KEY, controller.findBySession);
    expect(role).toBe(ApiKeyRole.OPERATOR);
  });

  it('findOne requires OPERATOR role', () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- reading route metadata, not invoking
    const role = reflector.get<ApiKeyRole>(REQUIRED_ROLE_KEY, controller.findOne);
    expect(role).toBe(ApiKeyRole.OPERATOR);
  });

  it('cross-session findAll requires OPERATOR role', () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- reading route metadata, not invoking
    const role = reflector.get<ApiKeyRole>(REQUIRED_ROLE_KEY, listController.findAll);
    expect(role).toBe(ApiKeyRole.OPERATOR);
  });

  // ── redrive sends real events: ADMIN only, scoped by the key, audited ─────

  it('delivery-failure redrive requires ADMIN role', () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- reading route metadata, not invoking
    const role = reflector.get<ApiKeyRole>(REQUIRED_ROLE_KEY, listController.redriveDeliveryFailures);
    expect(role).toBe(ApiKeyRole.ADMIN);
  });

  it("delivery-failure redrive passes the key's allowedSessions and audits the counts", async () => {
    const result = { redriven: 2, delivered: 2, enqueued: 0, failed: 1, skipped: 0, remaining: 4 };
    redrive.redrive.mockResolvedValue(result);
    const apiKey = { id: 'key-1', allowedSessions: ['sess-1'] } as unknown as ApiKey;

    await expect(listController.redriveDeliveryFailures({ sessionId: 'sess-1', limit: 10 }, apiKey)).resolves.toBe(
      result,
    );

    expect(redrive.redrive).toHaveBeenCalledWith({ sessionId: 'sess-1', limit: 10 }, ['sess-1']);
    expect(audit.logInfo).toHaveBeenCalledWith(AuditAction.WEBHOOK_DELIVERIES_REDRIVEN, {
      apiKey,
      sessionId: 'sess-1',
      metadata: { webhookId: undefined, ids: undefined, redriven: 2, failed: 1, skipped: 0, remaining: 4 },
    });
  });
});
