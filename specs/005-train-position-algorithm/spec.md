# Feature Specification: Train Position Algorithm with Station Parking

**Feature Branch**: `005-train-position-algorithm`
**Created**: 2025-12-06
**Status**: Draft
**Input**: User description: "Create a new algorithm to calculate the position of the train based on last position + delay + arrival times, and also on having the trains on each station 'parked' perpendicular around a station when STOPPED_AT there, around the position of the marker. Give the user the option to choose between algorithms."

**Context**: Currently, trains are positioned based solely on real-time GPS coordinates from the API. This approach has limitations: positions update at fixed intervals (polling), and when trains are stopped at stations, they overlap with the station marker. A predictive algorithm would provide smoother animations between updates and better visual representation of stopped trains.

## Clarifications

### Session 2025-12-06

- Q: Which positioning algorithm should be the default? → A: GPS-only (current behavior) for backward compatibility
- Q: Where should the algorithm toggle be placed in the UI? → A: Map controls panel, near zoom buttons
- Q: How many parking slots per station? → A: 5 slots maximum, distributed perpendicular to track
- Q: How should parking slots be assigned? → A: Deterministic hash of trainId for consistent slot assignment
- Q: What spacing between parking slots? → A: 20 meters base spacing at zoom 14, scales with zoom
- Q: How should trains transition when switching algorithms? → A: Smooth 500ms animation to new position
- Q: When should predictive algorithm fall back to GPS? → A: When schedule data unavailable or GPS is very recent (<30s)
- Q: How should GPS and predicted positions be blended? → A: 70% predicted, 30% GPS when GPS is recent
- Q: What TTL for trip details cache? → A: 10 minutes, max 200 entries

### Metro Compatibility (Future-Proofing)

- Q: Will this algorithm work for Metro when integrated? → A: Yes, with abstraction layer
- Q: How to handle Metro's multi-line stations (interchanges)? → A: Use explicit `lineId` for all calculations, not inferred from routeId
- Q: How to determine which line a train is on at shared stations? → A: Use `LineResolver` abstraction with multiple resolution strategies
- Q: How should parking work at Metro interchanges with 5+ lines? → A: Group trains by line sector, each line gets its own perpendicular direction
- Q: What if Metro API doesn't provide lineId directly? → A: Infer from tripId→lineId mapping or from stations served by trip

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Predictive Position Interpolation (Priority: P1)

When viewing trains on the map, users need smooth and realistic train movement between position updates. The predictive algorithm calculates train positions based on last known position, scheduled arrival times, and current delays to provide continuous motion interpolation.

**Why this priority**: This is the core problem to solve. Current GPS-only positioning causes trains to "jump" between poll intervals. Predictive interpolation provides smooth, realistic movement that matches expected train behavior based on schedule data.

**Independent Test**: Can be tested by observing a moving train between two stations, verifying that its position updates smoothly rather than jumping discretely every poll interval.

**Acceptance Scenarios**:

1. **Given** a train is traveling between Station A and Station B, **When** the last GPS update was 10 seconds ago, **Then** the train's displayed position is interpolated along the railway line based on expected progress using schedule/delay data

2. **Given** a train has scheduled arrival at Station B in 2 minutes with a 30-second delay, **When** viewing the train, **Then** the position reflects the adjusted expected progress accounting for the delay

3. **Given** a new GPS position arrives, **When** the predicted position differs from actual, **Then** the train smoothly transitions from predicted to actual position without jarring jumps

---

### User Story 2 - Station Parking for Stopped Trains (Priority: P1)

When trains are stopped at a station (status: STOPPED_AT), users need to see them "parked" around the station marker in a visually organized manner, perpendicular to the railway line, rather than overlapping with the station icon.

**Why this priority**: Equally critical to predictive movement. When multiple trains stop at the same station, they currently overlap and obscure each other and the station marker. Parking trains in organized slots around the station improves visual clarity.

**Independent Test**: Can be tested by viewing a station with multiple stopped trains, verifying they are displayed in organized parking slots around the station marker rather than stacked on top of each other.

**Acceptance Scenarios**:

1. **Given** a train status is STOPPED_AT station X, **When** viewing the station, **Then** the train is displayed in a parking slot perpendicular to the railway line, offset from the station marker

2. **Given** 3 trains are stopped at the same station, **When** viewing the station, **Then** each train occupies a distinct parking slot arranged around the station marker

3. **Given** a stopped train departs (status changes from STOPPED_AT), **When** the departure is detected, **Then** the train smoothly transitions from its parking slot back onto the railway line

4. **Given** trains are parked at a station, **When** zooming in/out, **Then** parking slot positions scale appropriately to remain visually coherent

---

### User Story 3 - Algorithm Selection Toggle (Priority: P1)

Users need the ability to switch between the current GPS-only positioning and the new predictive algorithm, allowing comparison and fallback if predictive positioning doesn't match expectations.

**Why this priority**: Essential for user control and debugging. Users may prefer one algorithm over another depending on their use case, and having a toggle allows graceful degradation if the predictive algorithm has issues.

**Independent Test**: Can be tested by toggling the algorithm selector and verifying trains immediately switch between GPS-only and predictive positioning modes.

**Acceptance Scenarios**:

1. **Given** the user opens the algorithm settings, **When** they select "GPS Only", **Then** trains are positioned using only real-time GPS coordinates (current behavior)

2. **Given** the user selects "Predictive (Schedule-based)", **When** viewing trains, **Then** trains use the new interpolation and station parking algorithm

3. **Given** the user switches algorithms while viewing trains, **When** the toggle is changed, **Then** trains smoothly transition to their new positions under the selected algorithm

4. **Given** the user refreshes the page, **When** viewing trains, **Then** their previously selected algorithm preference is restored

---

### Edge Cases

- **What happens when schedule data is unavailable for a train?**
  Fall back to GPS-only positioning for that specific train while others use predictive.

- **What happens when delay data is stale or unavailable?**
  Use schedule times without delay adjustment; if no schedule data, fall back to GPS-only.

- **How are parking slots assigned when more trains arrive than available slots?**
  Implement overflow stacking with slight vertical offset to ensure all trains remain visible.

- **What happens at terminal stations where trains reverse direction?**
  Parking slots should account for the train's next direction when departing.

- **How does the algorithm handle trains with incorrect/missing STOPPED_AT status?**
  Use GPS velocity (if available) or position change rate to infer stopped state.

## Requirements *(mandatory)*

### Functional Requirements

**Predictive Position Algorithm (Priority P1)**:

- **FR-001**: System MUST calculate train position by interpolating between last known GPS position and expected position based on schedule data and delays

- **FR-002**: System MUST use railway line geometry to constrain interpolated positions to valid track locations

- **FR-003**: System MUST smoothly blend predicted positions with actual GPS updates when new data arrives

- **FR-004**: System MUST gracefully fall back to GPS-only positioning when schedule/delay data is unavailable

**Station Parking (Priority P1)**:

- **FR-005**: System MUST detect trains with STOPPED_AT status and position them in parking slots around the station marker

- **FR-006**: System MUST arrange parking slots perpendicular to the railway line direction at the station

- **FR-007**: System MUST assign unique parking slots to each stopped train at a station, preventing overlap

- **FR-008**: System MUST animate trains smoothly when transitioning between moving and parked states

- **FR-009**: System MUST scale parking slot distances appropriately with map zoom level

**Algorithm Selection (Priority P1)**:

- **FR-010**: System MUST provide a UI toggle to switch between "GPS Only" and "Predictive" positioning algorithms

- **FR-011**: System MUST persist algorithm preference in local storage across sessions

- **FR-012**: System MUST apply algorithm change immediately without page refresh

- **FR-013**: UI toggle MUST be accessible from the map controls or settings panel

**Performance & Compatibility**:

- **FR-014**: Predictive algorithm MUST not degrade rendering performance below 30 FPS with 100+ trains

- **FR-015**: Position interpolation MUST update at 60 FPS for smooth visual animation

- **FR-016**: System MUST maintain existing train click/hover functionality with new positioning

### Key Entities

- **TrainPosition**: Extended with optional schedule data:
  - `scheduledArrival`: Expected arrival time at next station
  - `actualDelay`: Current delay in seconds
  - `status`: Movement state (IN_TRANSIT, STOPPED_AT, etc.)
  - `nextStationId`: Identifier for next stop

- **ParkingSlot**: New entity for station parking:
  - `stationId`: Station this slot belongs to
  - `slotIndex`: Position in the parking arrangement (0, 1, 2, ...)
  - `offsetDirection`: Perpendicular direction from railway line
  - `offsetDistance`: Distance from station center

- **AlgorithmConfig**: User preference state:
  - `positioningMode`: 'gps-only' | 'predictive'
  - Persisted in localStorage

- **InterpolationState**: Per-train interpolation data:
  - `lastGpsPosition`: Most recent GPS coordinates
  - `lastGpsTimestamp`: When GPS was received
  - `predictedPosition`: Current calculated position
  - `targetPosition`: Expected end position
  - `progress`: 0-1 interpolation progress

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Train movement appears smooth with no visible "jumping" between positions (visual inspection during 60-second observation period)

- **SC-002**: Stopped trains at stations are visually separated with no overlap (minimum 10px gap between train models at zoom level 14+)

- **SC-003**: Algorithm toggle responds within 200ms with smooth position transitions

- **SC-004**: System maintains 30+ FPS performance with predictive algorithm enabled and 100+ trains

- **SC-005**: Predicted positions deviate from actual GPS by less than 50 meters on average when train is in transit

- **SC-006**: Algorithm preference persists correctly across page refresh (100% consistency)

- **SC-007**: Users can click/select trains accurately regardless of which algorithm is active

## Architecture: Multi-Network Support

This feature is designed to support future Metro integration. The key architectural decisions:

### Line Resolution Abstraction

All position calculations require explicit `lineId` context. A `LineResolver` interface abstracts how line identity is determined:

```typescript
interface LineResolver {
  resolveLineId(train: TrainPosition, tripDetails?: TripDetails): string | null;
  lineServesStation(lineId: string, stationId: string): boolean;
  getLineBearingAtStation(lineId: string, stationId: string): number;
}
```

**Rodalies**: Simple 1:1 mapping (routeId → lineId)
**Metro**: Complex resolution using tripId mapping or station inference

### Network Adapter Pattern

A `TransitNetworkAdapter` encapsulates network-specific configuration:

```typescript
interface TransitNetworkAdapter {
  networkType: 'rodalies' | 'metro';
  lineResolver: LineResolver;
  parkingConfig: ParkingLayoutConfig;
  predictiveConfig: PredictiveConfig;
}
```

### Key Differences: Rodalies vs Metro

| Aspect | Rodalies | Metro |
|--------|----------|-------|
| Stations per line | Few shared | Many interchanges |
| Line identification | routeId = lineId | Requires resolution |
| Parking layout | Simple perpendicular | Line-grouped sectors |
| Station bearings | One dominant | Per-line bearing |
| Typical trains at station | 1-2 | 5-10 at interchanges |

### Implementation Strategy

1. **Phase 1-5**: Implement for Rodalies with abstractions in place
2. **Future**: Add `MetroLineResolver` and `MetroNetworkAdapter` when Metro data available
3. **No breaking changes**: Existing Rodalies code continues to work
