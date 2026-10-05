package com.rmyndharis.openwa.model;

/** One dependency's readiness snapshot, e.g. {@code {"status":"up"}}. */
public record DependencyStatus(String status) {}
