package com.rmyndharis.openwa.model;

/** Per-database readiness detail. Optional fields are {@code null} when absent. */
public record HealthReadyDetails(DependencyStatus mainDatabase, DependencyStatus dataDatabase) {}
