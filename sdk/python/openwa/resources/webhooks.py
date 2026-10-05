"""Webhooks resource — configure event delivery to external HTTP endpoints.

Backed by ``src/modules/webhook/webhook.controller.ts``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, TypedDict

from .._http import quote_segment
from ..types import (
    CreateWebhookRequest,
    RedriveWebhookDeliveriesRequest,
    UpdateWebhookRequest,
    WebhookDeliveryFailure,
    WebhookRedriveResult,
    WebhookResponse,
    WebhookTestResult,
)

if TYPE_CHECKING:
    from .._http import HttpExecutor


class WebhookListQuery(TypedDict, total=False):
    """Pagination for the cross-session webhook list and the delivery-failure log."""

    limit: int
    offset: int


class DeliveryFailureQuery(WebhookListQuery, total=False):
    """Filter for :meth:`WebhooksResource.delivery_failures`."""

    sessionId: str


class WebhooksResource:
    def __init__(self, http: "HttpExecutor") -> None:
        self._http = http

    def list_all(self, query: WebhookListQuery | None = None) -> list[WebhookResponse]:
        """List webhooks across EVERY session the key can see, not one session's.

        Requires an OPERATOR-level key.
        """
        return self._http.request("GET", "/api/webhooks", query=query)

    def delivery_failures(self, query: DeliveryFailureQuery | None = None) -> list[WebhookDeliveryFailure]:
        """Deliveries the gateway gave up on or could not dispatch: the diagnostic for a webhook that stopped arriving.

        Rows with ``attempts > 0`` exhausted their retries against the receiver. Rows with ``attempts == 0``
        were not given up after retries: the payload was over the size cap or could not be prepared or
        serialized, dispatch capacity was shed, or shutdown interrupted the delivery (possibly between
        retries, after earlier attempts were sent). A row is removed once a later replay delivers the event.

        Requires an ADMIN-level key. A delivery a smart filter suppressed never reaches this log. Most
        recent first.
        """
        return self._http.request("GET", "/api/webhooks/delivery-failures", query=query)

    def redrive_delivery_failures(self, body: RedriveWebhookDeliveriesRequest | None = None) -> WebhookRedriveResult:
        """Replay recorded deliveries in one bounded batch, fewest attempts first, then oldest.

        Only rows with ``replayable: True`` in :meth:`delivery_failures` qualify: terminal rows recorded while
        the gateway's ``WEBHOOK_FAILURE_PAYLOAD_RETENTION_HOURS`` is above 0. Each replay reuses the stored
        idempotency key, so a receiver that already handled the event can dedup it. Requires an ADMIN-level
        key; rows outside the key's allowedSessions are never touched.
        """
        return self._http.request("POST", "/api/webhooks/delivery-failures/redrive", body=body or {})

    def list(self, session_id: str) -> list[WebhookResponse]:
        return self._http.request("GET", f"/api/sessions/{quote_segment(session_id)}/webhooks")

    def get(self, session_id: str, webhook_id: str) -> WebhookResponse:
        return self._http.request("GET", f"/api/sessions/{quote_segment(session_id)}/webhooks/{quote_segment(webhook_id)}")

    def create(self, session_id: str, body: CreateWebhookRequest) -> WebhookResponse:
        return self._http.request("POST", f"/api/sessions/{quote_segment(session_id)}/webhooks", body=body)

    def update(self, session_id: str, webhook_id: str, body: UpdateWebhookRequest) -> WebhookResponse:
        return self._http.request(
            "PUT", f"/api/sessions/{quote_segment(session_id)}/webhooks/{quote_segment(webhook_id)}", body=body
        )

    def delete(self, session_id: str, webhook_id: str) -> None:
        self._http.request("DELETE", f"/api/sessions/{quote_segment(session_id)}/webhooks/{quote_segment(webhook_id)}")

    def test(self, session_id: str, webhook_id: str) -> WebhookTestResult:
        return self._http.request(
            "POST", f"/api/sessions/{quote_segment(session_id)}/webhooks/{quote_segment(webhook_id)}/test"
        )
