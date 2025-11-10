# Feature Specification: Train Line Color Differentiation and Zoom-Responsive Sizing

**Feature Branch**: `003-train-line-colors-zoom`
**Created**: 2025-11-10
**Status**: Draft
**Input**: User description: "As an user, I want to be able to easily differenciate between train lines when zooming in, and that the trains mantain appropiate size on zooming."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Visual Line Differentiation (Priority: P1)

When viewing multiple trains on the map, users need to quickly identify which line each train belongs to without clicking or hovering. This is especially important when trains from different lines are close together or when users are tracking a specific line's service status.

**Why this priority**: This is the core value proposition of the feature. Without visual differentiation, users cannot easily understand the service distribution across lines at a glance. This is fundamental to the map's usability for planning journeys or monitoring service status.

**Independent Test**: Can be fully tested by loading the map with active trains from multiple lines and verifying that each train displays its line's brand color. Delivers immediate value by making line identification instant and intuitive.

**Acceptance Scenarios**:

1. **Given** the map displays trains from multiple lines (e.g., R1, R2, R3), **When** I view the map without interacting with any trains, **Then** I can visually distinguish trains by their line colors (R1 in light blue #7DBCEC, R2 in green #26A741, R3 in red #EB4128, etc.)

2. **Given** trains from different lines are positioned close together on the map, **When** I observe the train cluster, **Then** I can identify which train belongs to which line based on its color without needing to click or hover

3. **Given** I have selected a specific line in the legend (e.g., R1), **When** I view the map, **Then** trains from the selected line maintain their full brand color while other trains are dimmed or hidden according to the highlight mode

---

### User Story 2 - Zoom-Responsive Train Sizing (Priority: P2)

Users need trains to maintain appropriate visual size as they zoom in and out of the map. At high zoom levels (close view), trains should not become disproportionately large and block the view. At low zoom levels (overview), trains should remain visible and not become too small to see.

**Why this priority**: This ensures consistent usability across different zoom levels. While color differentiation (P1) is more critical for line identification, appropriate sizing is essential for a professional, polished user experience and prevents trains from dominating the view at close zoom.

**Independent Test**: Can be tested by zooming from minimum to maximum zoom levels and verifying that train models maintain appropriate screen-space size throughout. Delivers value by ensuring trains are always visible but never obstructive.

**Acceptance Scenarios**:

1. **Given** I am viewing the map at the default zoom level, **When** I zoom in to view a specific station area, **Then** train models maintain a consistent screen-space size (not growing exponentially with zoom level)

2. **Given** I am viewing the map at maximum zoom (closest view), **When** I observe train positions, **Then** trains remain at an appropriate size that doesn't obscure the map details or overwhelm the viewport

3. **Given** I am viewing the overview of the entire Rodalies network at minimum zoom, **When** I look for active trains, **Then** trains remain visible and recognizable (not shrinking to invisible pixels)

4. **Given** I zoom smoothly from minimum to maximum zoom, **When** observing train size changes, **Then** the size transition appears smooth and natural without jarring jumps or sudden changes

---

### Edge Cases

- **What happens when a train's route cannot be mapped to a known line color?**
  The system should fall back to a neutral default color (e.g., gray or white) to ensure the train is still visible and doesn't cause rendering errors.

- **How does the system handle trains on lines with very similar colors (e.g., R2 #26A741 and R2S #146520)?**
  While the colors are distinct in the data, visual testing should verify they remain distinguishable on the map. If needed, the specification assumes that existing line colors have sufficient contrast.

- **What happens to train colors when high contrast mode is enabled?**
  Train colors should respect the high contrast mode setting, potentially using stronger, more saturated versions of the brand colors or using high-contrast patterns while maintaining line differentiation.

- **How does color differentiation interact with the stale data indicator?**
  Stale trains (data older than 60 seconds) already reduce opacity to 50%. The line color should remain visible but dimmed, ensuring users can still identify the line while understanding the data is outdated.

- **What happens at extreme zoom levels beyond the typical range?**
  The system should clamp train sizes to minimum and maximum screen-space dimensions to prevent either invisible trains or trains that fill the entire screen.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST color each 3D train model according to its associated line's brand color as defined in the RodaliesLine data (`brand_color` property)

- **FR-002**: System MUST maintain accurate color-to-line mapping by extracting the line code from each train's `routeId` and matching it to the corresponding line's brand color

- **FR-003**: System MUST provide a fallback default color (neutral gray or white) for trains whose route cannot be mapped to a known line

- **FR-004**: Train colors MUST remain visible and distinguishable when trains are in dimmed state (25% opacity in highlight mode, 50% opacity when stale data)

- **FR-005**: Train colors MUST respect the user's high contrast mode setting, using appropriate color adjustments or patterns while maintaining line differentiation

- **FR-006**: System MUST implement zoom-responsive sizing that keeps trains at a consistent screen-space size regardless of map zoom level

- **FR-007**: System MUST define minimum and maximum screen-space dimensions for train models to prevent extreme sizes at unusual zoom levels

- **FR-008**: Train size scaling MUST apply smoothly across zoom transitions without jarring jumps or sudden changes

- **FR-009**: System MUST maintain train hover and click detection accuracy across all zoom levels and size scales

- **FR-010**: Train coloring and sizing MUST not negatively impact rendering performance (maintain 30+ FPS target with 100+ trains)

### Key Entities

- **RodaliesLine**: Contains the brand color definition for each train line. Each line has a unique `brand_color` (hex color without #) that will be applied to trains on that line.

- **TrainPosition**: Contains the `routeId` that must be parsed to extract the line code (e.g., "R1", "R2N") for color lookup. The route ID format follows patterns like "R1_DIRECTION" or similar.

- **TrainMesh**: The 3D model instance for each train that will be colored. Must support material color modification and screen-space size scaling based on map zoom level.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can identify a train's line within 1 second of viewing the map without needing to interact with the train (measured through user testing)

- **SC-002**: Train models maintain appropriate visual size across the full zoom range, occupying between 15-35 pixels in screen-space height at typical viewing distances

- **SC-003**: Color differentiation reduces user confusion about line assignment by at least 80% compared to monochrome trains (measured through A/B testing or user feedback)

- **SC-004**: System maintains 30+ FPS performance with 100+ colored and zoom-scaled trains active simultaneously

- **SC-005**: Users report improved ability to track specific lines in user satisfaction surveys, with at least 85% of users rating line identification as "easy" or "very easy"

- **SC-006**: Zero instances of trains becoming too large (>50% of viewport) or too small (<10 pixels) at any zoom level within the typical zoom range (5-17)
