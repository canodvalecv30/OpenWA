package com.rmyndharis.openwa.model;

import java.util.List;

/**
 * Response from {@code GET /messages/batch/:batchId} (batch status polling). Distinct from
 * {@link BulkMessageResponse} (the send-bulk acknowledgement) and {@link BatchCancelResponse}.
 * Optional fields are {@code null} when absent.
 */
public record BatchStatusResponse(
    String batchId,
    BatchLifecycleStatus status,
    BatchProgress progress,
    List<BatchMessageResult> results,
    String startedAt,
    String completedAt) {}
