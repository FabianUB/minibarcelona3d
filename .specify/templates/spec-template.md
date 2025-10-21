# Feature Specification: [FEATURE NAME]

**Feature Branch**: `[###-feature-name]`  
**Created**: [DATE]  
**Status**: Draft  
**Input**: User description: "$ARGUMENTS"

## User Scenarios & Testing *(mandatory)*

Prioritize journeys that deliver a usable, map-first experience. Each user story must:
- Keep the Mapbox layer visible and interactive.
- Surface real-time train state/timestamp data and stale-data handling.
- Be independently testable with pre-written automated tests (Vitest/Playwright or Go integration tests).

### User Story 1 - [Brief Title] (Priority: P1)

[Describe this user journey in plain language]

**Why this priority**: [Explain the value and why it has this priority level]

**Independent Test**: [Describe how this can be tested independently - e.g., "Can be fully tested by [specific action] and delivers [specific value]"]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]
2. **Given** [initial state], **When** [action], **Then** [expected outcome]

---

### User Story 2 - [Brief Title] (Priority: P2)

[Describe this user journey in plain language]

**Why this priority**: [Explain the value and why it has this priority level]

**Independent Test**: [Describe how this can be tested independently]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]

---

### User Story 3 - [Brief Title] (Priority: P3)

[Describe this user journey in plain language]

**Why this priority**: [Explain the value and why it has this priority level]

**Independent Test**: [Describe how this can be tested independently]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]

---

[Add more user stories as needed, each with an assigned priority]

### Edge Cases

- Mapbox token missing, expired, or rate-limited.
- Backend poll skips (no new snapshot within two intervals).
- Train status transitions to UNKNOWN or receives conflicting trip data.
- User loads the site on a narrow viewport or with reduced motion preferences.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: API MUST expose Rodalies train positions, statuses, and timestamps derived from `rt_rodalies_vehicle_current`.
- **FR-002**: Frontend MUST render trains on the Mapbox layer with overlays that remain usable at ≥320 px width.
- **FR-003**: UI MUST surface stale-data warnings when backend snapshots exceed two poll intervals.
- **FR-004**: System MUST log structured events (request ID, poll cycle) for traceability.
- **FR-005**: CI MUST run Go tests, Vitest, Playwright, lint, accessibility, and bundle-budget checks before merge.

*Mark uncertain requirements with `TODO(<context>): clarification needed` so they appear in follow-up lists.*

### Key Entities *(include if feature involves data)*

- **Train**: Represents a Rodalies vehicle with id, label, position, status, and timestamps.
- **Snapshot**: Represents a poll iteration that groups train updates and feeds stale-data logic.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users see current train positions and states within two poll intervals of data availability.
- **SC-002**: API endpoints deliver <300 ms p95 latency under expected load in staging.
- **SC-003**: Accessibility audits (axe/Playwright) report zero critical violations on map overlays.
- **SC-004**: Frontend bundle-size delta stays within ±10% of baseline unless explicitly approved.
