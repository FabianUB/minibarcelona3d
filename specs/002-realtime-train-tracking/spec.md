# Feature Specification: Real-Time Train Tracking with 3D Visualization

**Feature Branch**: `002-realtime-train-tracking`
**Created**: 2025-10-24
**Status**: Draft
**Input**: User description: "As a user, I want to see the position of real maps from Rodalies on the map, with 3D models of the trains rendered on their real time position. When I click on the trains I want to see information about the trains, the route is doing, the stops and the delays."

## Clarifications

### Session 2025-10-24

- Q: What is the data source for real-time train position and schedule information? → A: Go API will get data from PostgreSQL database with Rodalies real-time data
- Q: How should trains be positioned relative to lines and how is orientation determined? → A: Trains must be rendered on top of the lines they represent. Train orientation can be derived from the next station information, which is always known

## User Scenarios & Testing

### User Story 1 - View Real-Time Train Positions (Priority: P1)

Users can see the current location of all active Rodalies trains displayed on the map, updating in real-time as trains move along their routes.

**Implementation Note**: This story is delivered in two phases - first as 2D markers (Phase B proof-of-concept), then enhanced to 3D models (Phase C). The acceptance criteria below represent the final 3D implementation.

**Why this priority**: Core value proposition - without real-time train visualization, the feature provides no value. This is the foundation upon which all other functionality depends.

**Independent Test**: Can be fully tested by loading the map and observing train positions updating without requiring any interaction. Delivers immediate value by showing where trains are right now.

**Acceptance Scenarios**:

1. **Given** the map is loaded and there are active trains on the network, **When** the user views the map, **Then** they see train visualizations positioned at the trains' current real-time locations on the correct rail lines
   - **Phase B (MVP)**: 2D marker dots
   - **Phase C (Enhanced)**: 3D train models
2. **Given** trains are moving on their routes, **When** the user observes the map over time, **Then** the 3D train models smoothly update their positions to reflect real-time movement
3. **Given** multiple trains are on the same line, **When** the user views that line, **Then** each train is individually visible and distinguishable
4. **Given** a train has stopped at a station, **When** the user views that location, **Then** the train model is positioned at the station platform

---

### User Story 2 - Access Train Information Panel (Priority: P2)

Users can click on any visible train to open an information panel showing details about that specific train, including its route, scheduled stops, and current delay status.

**Why this priority**: Essential for user engagement - visualization alone is interesting but not actionable. Users need context about what they're seeing to make informed decisions about their travel.

**Independent Test**: Can be tested independently by clicking any train model and verifying the information panel appears with correct data. Delivers value even if real-time updates are simplified.

**Acceptance Scenarios**:

1. **Given** a train is visible on the map, **When** the user clicks on the train's 3D model, **Then** an information panel opens displaying the train's details
2. **Given** the information panel is open for a train, **When** the user views the panel, **Then** they see the route identifier, direction, and current trip information
3. **Given** the information panel is open, **When** the user reviews the stops section, **Then** they see a chronological list of all stops on the route with scheduled times
4. **Given** a train is running late, **When** the user views the information panel, **Then** they see the current delay duration displayed prominently
5. **Given** an information panel is open, **When** the user clicks outside the panel or on a close button, **Then** the panel closes and returns to the map view

---

### User Story 3 - View Stop Details and Status (Priority: P3)

Users can see detailed information for each stop on a train's route, including whether the stop has been completed, is current, or is upcoming, along with actual vs. scheduled arrival times.

**Why this priority**: Enhances usefulness for trip planning - helps users determine if they can catch a specific train or estimate arrival times at their destination. Builds on P2 functionality.

**Independent Test**: Can be tested by opening a train's information panel and examining the stop list. Delivers value for users planning journeys even without the full 3D visualization.

**Acceptance Scenarios**:

1. **Given** the train information panel is open, **When** the user views the stop list, **Then** past stops are marked as completed with actual arrival times
2. **Given** a train is currently at a station, **When** the user views the stop list, **Then** the current stop is highlighted and shows the current time
3. **Given** a train has upcoming stops, **When** the user views the stop list, **Then** future stops show scheduled arrival times
4. **Given** a stop was delayed, **When** the user views that stop in the list, **Then** both scheduled and actual times are displayed with the delay duration

---

### User Story 4 - Filter Trains by Line (Priority: P4)

Users can filter the displayed trains to show only those belonging to specific Rodalies lines, reducing visual clutter when focusing on a particular route.

**Why this priority**: Quality of life improvement - helps users in congested areas or when tracking specific lines. The feature is fully functional without filtering, but this enhances usability.

**Independent Test**: Can be tested using the existing legend/line selection functionality. Delivers value by reducing cognitive load when many trains are visible.

**Acceptance Scenarios**:

1. **Given** multiple trains from different lines are visible, **When** the user selects a specific line from the legend, **Then** only trains operating on that line remain visible
2. **Given** a line filter is active, **When** the user clicks a filtered-out train's line, **Then** that line's trains become visible
3. **Given** multiple lines are selected, **When** the user views the map, **Then** trains from all selected lines are visible
4. **Given** a filter is active and the information panel is open, **When** the user changes the filter, **Then** the panel closes if the displayed train is no longer in the filter

---

### Edge Cases

- What happens when real-time data is temporarily unavailable (API timeout, network issue)?
- How does the system handle trains that appear off-route due to data inconsistencies?
- What happens when a train position hasn't updated for an extended period (stale data)?
- How are trains represented when stopped at multi-platform stations?
- What happens when clicking on overlapping trains (multiple trains very close together)?
- How does the system handle trains that are significantly ahead or behind schedule?
- What happens during service disruptions when trains are rerouted or cancelled?
- How are express trains (skipping stops) differentiated from all-stop trains on the same line?

## Requirements

### Functional Requirements

- **FR-001**: System MUST display 3D models of trains at their real-time GPS coordinates on the map
- **FR-002**: System MUST update train positions at regular intervals to reflect current location data
- **FR-003**: System MUST fetch real-time train position data from the Go API backend, which retrieves data from a PostgreSQL database containing Rodalies real-time information
- **FR-004**: System MUST render trains as distinct 3D models that are visually different from the line geometry
- **FR-005**: System MUST render train models on top of (with higher z-index than) their corresponding line geometry
- **FR-006**: System MUST orient train models based on the direction toward their next station
- **FR-007**: System MUST make train models interactive (clickable) to trigger information display
- **FR-008**: System MUST open an information panel when a user clicks on a train model
- **FR-009**: Information panel MUST display the train's route identifier and direction
- **FR-010**: Information panel MUST display a complete list of stops for the current trip
- **FR-011**: Information panel MUST display scheduled times for each stop
- **FR-012**: Information panel MUST display current delay information if the train is running late or early
- **FR-013**: System MUST visually indicate stop status (completed, current, upcoming) in the stop list
- **FR-014**: System MUST display both scheduled and actual times when they differ
- **FR-015**: System MUST associate each train with its corresponding Rodalies line for filtering
- **FR-016**: System MUST hide/show trains based on active line selection in the legend
- **FR-017**: System MUST handle missing or stale train position data gracefully without crashes
- **FR-018**: System MUST provide visual feedback when real-time data is unavailable
- **FR-019**: System MUST interpolate train positions between updates for smooth movement animation

### Key Entities

- **Train**: Represents a physical train currently operating on the network
  - Attributes: unique identifier, current GPS position (latitude/longitude), next station identifier, current speed, associated line, current trip/route, operational status
  - Relationships: belongs to one Line, follows one Route/Trip, visits multiple Stops, heading toward next Station

- **Trip**: Represents a scheduled journey from origin to destination
  - Attributes: trip identifier, route identifier, direction, start time, end time, list of scheduled stops
  - Relationships: associated with one Train (at a given time), belongs to one Line, includes multiple StopTimes

- **StopTime**: Represents a train's interaction with a specific stop on a trip
  - Attributes: stop identifier, scheduled arrival time, actual arrival time, delay duration, status (completed/current/upcoming), stop sequence order
  - Relationships: belongs to one Trip, references one Station

- **Station**: Represents a physical station on the network (already exists from 001-show-rodalies-map)
  - Additional context: StopTimes reference existing Station entities

- **Real-Time Update**: Represents the latest data about a train's position and status
  - Attributes: timestamp, train position, delay information, trip updates, last update time
  - Relationships: updates one Train

## Success Criteria

### Measurable Outcomes

- **SC-001**: Users can see trains updating their positions on the map within 30 seconds of actual movement
- **SC-002**: Information panel opens within 500ms of clicking a train model
- **SC-003**: System displays real-time positions for at least 95% of active trains during normal operations
- **SC-004**: Train position updates occur at least every 30 seconds during active service
- **SC-005**: Users can identify a train's current delay status within 3 seconds of opening the information panel
- **SC-006**: System handles at least 100 concurrent active trains without performance degradation
- **SC-007**: 90% of users can successfully determine if they can catch a specific train based on displayed information
- **SC-008**: Information panel displays complete trip information (route, stops, delays) for 100% of active trains
- **SC-009**: System recovers from temporary data unavailability within 1 minute without requiring user intervention

## Assumptions

- The Go API backend is operational and has established connectivity to the PostgreSQL database
- PostgreSQL database is actively populated with current Rodalies real-time train data
- Train position updates in the database are refreshed at intervals between 10-60 seconds
- Each train record has a unique identifier that can be matched to route/trip information
- Database schema includes train position (GPS coordinates), heading/bearing, trip details, and delay information
- 3D train models can be simple geometric shapes (boxes/cylinders) rather than detailed replicas
- Users have already loaded the base map from feature 001-show-rodalies-map
- The existing legend/line selection functionality from 001 can be extended to filter trains
- Information panel will be a modal or side panel overlay on the map interface

## Dependencies

- Feature 001-show-rodalies-map must be implemented (provides base map, lines, stations, legend)
- Access to Rodalies real-time data feed (API credentials, endpoint documentation)
- Line and route metadata to associate trains with their operating lines
- Station/stop reference data to display stop names in information panel

## Out of Scope

- Historical train position replay or time-travel features
- Predictive arrival time calculations beyond what's provided in real-time data
- Multi-train comparison or journey planning features
- Notifications or alerts for specific trains or delays
- Train capacity/crowding information
- Detailed train specifications (car count, model, amenities)
- Integration with ticket purchasing or fare systems
- Real-time platform assignment changes
- Alternative route suggestions during disruptions
