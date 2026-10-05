package com.rmyndharis.openwa.model;

/**
 * Outcome of replaying recorded webhook deliveries.
 *
 * @param redriven rows replayed by this call: delivered plus enqueued
 * @param delivered delivered by a direct POST; their failure rows were removed
 * @param enqueued reserved for compatibility; operator redrive always returns zero
 * @param failed replays that failed again; their rows stay, with attempts raised by one
 * @param skipped rows not replayed: the webhook was removed, disabled or unsubscribed, or a plugin
 *     cancelled it
 * @param remaining replayable rows still in scope after this call
 */
public record WebhookRedriveResult(
    int redriven, int delivered, int enqueued, int failed, int skipped, int remaining) {}
