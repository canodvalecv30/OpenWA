package com.rmyndharis.openwa.model;

import java.util.List;

/**
 * Request body for replaying recorded webhook deliveries. Every field narrows; {@code null} fields
 * are omitted, and an empty body takes the least-retried eligible rows.
 */
public record RedriveWebhookDeliveriesRequest(String sessionId, String webhookId, List<String> ids, Integer limit) {
    public static Builder builder() {
        return new Builder();
    }

    public static final class Builder {
        private String sessionId;
        private String webhookId;
        private List<String> ids;
        private Integer limit;

        /** Only rows of this session (within the key's allowedSessions). */
        public Builder sessionId(String v) {
            this.sessionId = v;
            return this;
        }

        /** Only rows of this webhook. */
        public Builder webhookId(String v) {
            this.webhookId = v;
            return this;
        }

        /** Only these failure rows (ids from {@code deliveryFailures}), at most 500. */
        public Builder ids(List<String> v) {
            this.ids = v;
            return this;
        }

        /** Max rows replayed by this call (1-500, default 100). */
        public Builder limit(Integer v) {
            this.limit = v;
            return this;
        }

        public RedriveWebhookDeliveriesRequest build() {
            return new RedriveWebhookDeliveriesRequest(sessionId, webhookId, ids, limit);
        }
    }
}
