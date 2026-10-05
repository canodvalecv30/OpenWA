/**
 * Webhooks resource — configure event delivery to external HTTP endpoints.
 *
 * Backed by `src/modules/webhook/webhook.controller.ts`.
 * @packageDocumentation
 */

import { encodeSegment } from '../http.js';
import type { OpenWAClient } from '../client.js';
import type {
  CreateWebhookRequest,
  RedriveWebhookDeliveriesRequest,
  UpdateWebhookRequest,
  WebhookDeliveryFailure,
  WebhookRedriveResult,
  WebhookResponse,
  WebhookTestResult,
} from '../types.js';

/** Pagination for the cross-session webhook list and the delivery-failure log. */
export interface WebhookListQuery {
  limit?: number;
  offset?: number;
}

/** Filter for {@link WebhooksResource.deliveryFailures}. */
export interface DeliveryFailureQuery extends WebhookListQuery {
  sessionId?: string;
}

export class WebhooksResource {
  constructor(private readonly client: OpenWAClient) {}

  /**
   * List webhooks across EVERY session the key can see, not one session's. Requires an OPERATOR-level
   * key.
   */
  listAll(query?: WebhookListQuery): Promise<WebhookResponse[]> {
    return this.client.request<WebhookResponse[]>({ method: 'GET', path: '/api/webhooks', query });
  }

  /**
   * Deliveries the gateway gave up on or could not dispatch: the diagnostic to reach for when a webhook
   * stopped arriving. Rows with `attempts > 0` exhausted their retries against the receiver. Rows with
   * `attempts === 0` were not given up after retries: the payload was over the size cap or could not be
   * serialized after the webhook:before hooks, dispatch capacity was shed, or shutdown interrupted the
   * delivery (possibly between retries, after earlier attempts). A row is removed once a later replay
   * delivers the event. Requires an ADMIN-level key.
   *
   * A delivery a smart filter suppressed never reaches this log. Most recent first.
   */
  deliveryFailures(query?: DeliveryFailureQuery): Promise<WebhookDeliveryFailure[]> {
    return this.client.request<WebhookDeliveryFailure[]>({
      method: 'GET',
      path: '/api/webhooks/delivery-failures',
      query,
    });
  }

  /**
   * Replay recorded deliveries that still hold their event data (`replayable: true` in
   * {@link deliveryFailures}), fewest attempts first, then oldest, one bounded batch per call.
   * Each replay reuses the stored idempotency key, so a receiver that already handled the event can dedup it. Only rows recorded
   * while the gateway's `WEBHOOK_FAILURE_PAYLOAD_RETENTION_HOURS` is above 0 are replayable. Requires
   * an ADMIN-level key; rows outside the key's allowedSessions are never touched.
   */
  redriveDeliveryFailures(body: RedriveWebhookDeliveriesRequest = {}): Promise<WebhookRedriveResult> {
    return this.client.request<WebhookRedriveResult>({
      method: 'POST',
      path: '/api/webhooks/delivery-failures/redrive',
      body,
    });
  }

  /** List all webhooks for a session. */
  list(sessionId: string): Promise<WebhookResponse[]> {
    return this.client.request<WebhookResponse[]>({
      method: 'GET',
      path: `/api/sessions/${encodeSegment(sessionId)}/webhooks`,
    });
  }

  /** Get a single webhook by id. */
  get(sessionId: string, id: string): Promise<WebhookResponse> {
    return this.client.request<WebhookResponse>({
      method: 'GET',
      path: `/api/sessions/${encodeSegment(sessionId)}/webhooks/${encodeSegment(id)}`,
    });
  }

  /** Create a new webhook. */
  create(sessionId: string, body: CreateWebhookRequest): Promise<WebhookResponse> {
    return this.client.request<WebhookResponse>({
      method: 'POST',
      path: `/api/sessions/${encodeSegment(sessionId)}/webhooks`,
      body,
    });
  }

  /** Update a webhook. */
  update(sessionId: string, id: string, body: UpdateWebhookRequest): Promise<WebhookResponse> {
    return this.client.request<WebhookResponse>({
      method: 'PUT',
      path: `/api/sessions/${encodeSegment(sessionId)}/webhooks/${encodeSegment(id)}`,
      body,
    });
  }

  /** Delete a webhook. */
  delete(sessionId: string, id: string): Promise<void> {
    return this.client.request<void>({
      method: 'DELETE',
      path: `/api/sessions/${encodeSegment(sessionId)}/webhooks/${encodeSegment(id)}`,
    });
  }

  /** Trigger a test dispatch to the webhook URL and report the result. */
  test(sessionId: string, id: string): Promise<WebhookTestResult> {
    return this.client.request<WebhookTestResult>({
      method: 'POST',
      path: `/api/sessions/${encodeSegment(sessionId)}/webhooks/${encodeSegment(id)}/test`,
    });
  }
}
