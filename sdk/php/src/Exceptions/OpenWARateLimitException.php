<?php

declare(strict_types=1);

namespace OpenWA\Exceptions;

/**
 * 429 Too Many Requests — rate limited.
 *
 * The global rate limiter's 429 lifts when its window expires (seconds for the
 * per-second tier, up to an hour for the hourly tier by default), and
 * getRetryAfterSeconds() carries its Retry-After header. A 429 whose
 * getErrorCode() is "SEND_PACING_LIMITED" is usually not transient: do not
 * retry it before getRetryAfterSeconds(), which then comes from the body: a few
 * seconds when only sends still in flight caused it, the rest of the failure
 * breaker's cooldown (SEND_PACING_BREAKER_COOLDOWN_MS, 15 minutes by default)
 * after a run of send failures, otherwise up to the next UTC day.
 */
class OpenWARateLimitException extends OpenWAApiException
{
}
