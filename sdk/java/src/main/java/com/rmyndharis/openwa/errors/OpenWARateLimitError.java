package com.rmyndharis.openwa.errors;

import java.util.List;
import java.util.Map;

/**
 * 429 Too Many Requests — rate limited.
 *
 * <p>The global rate limiter's 429 lifts when its window expires (seconds for the per-second tier,
 * up to an hour for the hourly tier by default), and {@link #retryAfterSeconds()} carries its
 * {@code Retry-After} header. A 429 whose {@link #code()} is {@code "SEND_PACING_LIMITED"} is
 * usually not transient: do not retry it before {@link #retryAfterSeconds()}, which then comes from
 * the body: a few seconds when only sends still in flight caused it, the rest of the failure
 * breaker's cooldown ({@code SEND_PACING_BREAKER_COOLDOWN_MS}, 15 minutes by default) after a run of
 * send failures, otherwise up to the next UTC day.
 */
public class OpenWARateLimitError extends OpenWAApiError {
    public OpenWARateLimitError(String message, int status, Object body, String errorKind) {
        super(message, status, body, errorKind);
    }

    public OpenWARateLimitError(
            String message, int status, Object body, String errorKind, Map<String, List<String>> headers) {
        super(message, status, body, errorKind, headers);
    }
}
