package com.rmyndharis.openwa.model;

/**
 * A chat-list entry. Optional fields are {@code null} when absent.
 *
 * <p>{@code timestamp} is the Unix time in seconds of the last activity (unlike
 * {@code muteExpiration}, which is epoch milliseconds).
 */
public record ChatSummary(
    String id,
    String name,
    Boolean isGroup,
    Integer unreadCount,
    /** Preview text of the last message (the server returns a plain string, not an object). */
    String lastMessage,
    Long timestamp,
    ChatKind kind,
    Boolean archived,
    Boolean pinned,
    /** Whether the chat is muted right now, not the expiry behind it. */
    Boolean muted,
    /** Epoch milliseconds the mute ends, null unless muted; 0 means indefinitely. */
    Long muteExpiration) {}
