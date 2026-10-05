/**
 * OpenWA JavaScript/TypeScript SDK.
 *
 * Official client library for the OpenWA WhatsApp API Gateway.
 *
 * @example
 * ```typescript
 * import { OpenWAClient, OpenWAApiError } from '@rmyndharis/openwa';
 *
 * const client = new OpenWAClient({
 *   baseUrl: 'http://localhost:2785',
 *   apiKey: 'owa_k1_…',
 * });
 *
 * // Sessions are addressed by the UUID that create() returns, not by name.
 * const session = await client.sessions.create({ name: 'my-session' });
 * await client.sessions.start(session.id);
 * // Link the account before sending: scan sessions.getQrCode or use sessions.requestPairingCode,
 * // then wait for status 'ready'. An unlinked session answers the send with 409.
 * const result = await client.messages.sendText(session.id, {
 *   chatId: '628123456789@c.us',
 *   text: 'Hello from the OpenWA SDK!',
 * });
 * console.log(result.messageId);
 * ```
 *
 * @packageDocumentation
 */

export { OpenWAClient } from './client.js';
export { default } from './client.js';
export type { OpenWAClientOptions } from './client.js';
export * from './errors.js';
export type * from './types.js';
export type { BinaryResponse, ClientConfig, FetchLike, HttpMethod, RequestOptions } from './http.js';
export { buildUrl, encodeSegment, warnIfInsecureHttpUrl } from './http.js';
export type { ListChatsQuery } from './resources/chats.js';
export type { ListContactsQuery } from './resources/contacts.js';
export type { ListGroupsQuery } from './resources/groups.js';
export type { ListSessionsQuery } from './resources/sessions.js';
export type { DeliveryFailureQuery, WebhookListQuery } from './resources/webhooks.js';
export { verifyWebhookSignature } from './webhook.js';
