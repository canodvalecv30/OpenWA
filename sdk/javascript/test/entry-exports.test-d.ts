/**
 * Type-level check that the package entry point exposes what a consumer needs to type the public
 * resource methods; `tsc` is the gate (see `wire-contract.test-d.ts`). The `exports` map allows no
 * deep imports, so a query type declared in a resource file is unreachable unless `index.ts`
 * re-exports it.
 * @packageDocumentation
 */

import {
  encodeSegment,
  type DeliveryFailureQuery,
  type ListChatsQuery,
  type ListContactsQuery,
  type ListGroupsQuery,
  type ListSessionsQuery,
  type WebhookListQuery,
} from '../src/index.js';

const sessions: ListSessionsQuery = { name: 'my-session' };
const chats: ListChatsQuery = {};
const contacts: ListContactsQuery = {};
const groups: ListGroupsQuery = {};
const webhooks: WebhookListQuery = {};
const failures: DeliveryFailureQuery = {};
const segment: string = encodeSegment('628123456789@c.us');

export const entryExports = [sessions, chats, contacts, groups, webhooks, failures, segment];
