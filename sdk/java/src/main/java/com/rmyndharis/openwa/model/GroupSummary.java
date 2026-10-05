package com.rmyndharis.openwa.model;

/**
 * Item returned by {@code GET /sessions/:id/groups} (the slim list shape), and the
 * {@code groups.create} response.
 */
public record GroupSummary(
    String id,
    String name,
    /**
     * Only in a {@code groups.create} response, never in {@code groups.list}; {@code groups.get}
     * carries the participants.
     */
    Integer participantsCount,
    /**
     * Only in a {@code groups.create} response, never in {@code groups.list}; {@code groups.get}
     * carries each participant's role.
     */
    Boolean isAdmin,
    /** JID of the parent community, or {@code null} if standalone. */
    String linkedParentJID) {}
