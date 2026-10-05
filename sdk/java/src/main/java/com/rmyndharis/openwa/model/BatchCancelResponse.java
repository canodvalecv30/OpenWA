package com.rmyndharis.openwa.model;

/**
 * Response from {@code POST /messages/batch/:batchId/cancel}: the batch state without the
 * per-recipient results; call {@code batchStatus} for those.
 */
public record BatchCancelResponse(String batchId, BatchLifecycleStatus status, BatchProgress progress) {}
