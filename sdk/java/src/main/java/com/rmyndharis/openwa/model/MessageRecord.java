package com.rmyndharis.openwa.model;

import java.util.Map;

/**
 * A persisted message row, as returned by {@code GET /sessions/:id/messages}.
 * Optional fields are {@code null} when absent.
 */
public record MessageRecord(
    String id,
    String sessionId,
    /** Engine/WhatsApp message id; may be {@code null} until a send is acked. */
    String waMessageId,
    String chatId,
    String from,
    String to,
    String body,
    String type,
    MessageDirection direction,
    /**
     * Push name of the sender as the engine reported it (their saved contact name when it reported
     * no push name); in a group this is the member who posted, not the group subject. Null when no
     * name was known.
     */
    String chatName,
    /**
     * JID of the sender of a group, status or broadcast-list message ({@code from} is the group,
     * {@code status@broadcast} or the list id there; on Baileys a received list message is filed under
     * the sender, so {@code from} is the sender too). Null on 1:1 messages and outgoing echoes.
     */
    String author,
    /** Storage key of the archived media copy, when chat-media archiving wrote one. */
    String mediaPath,
    /** Mimetype of the archived media; null whenever mediaPath is. */
    String mediaMimetype,
    /** Unix timestamp in seconds. */
    Long timestamp,
    Map<String, Object> metadata,
    DeliveryStatus status,
    String createdAt) {}
