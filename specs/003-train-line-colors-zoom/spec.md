# Feature Specification: Enhanced Train Spatial Separation and Zoom-Responsive Sizing

**Feature Branch**: `003-train-line-colors-zoom`
**Created**: 2025-11-10
**Status**: Draft
**Input**: User description: "As an user, I want to be able to easily differenciate between train lines when zooming in, and that the trains mantain appropiate size on zooming."

**Context**: Railway lines on the map already have different colors (R1 blue, R2 green, etc.). Train 3D models are currently all the same appearance. When trains from different lines converge at the same location, they overlap making it difficult to distinguish them.

## Clarifications

### Session 2025-11-10

- Q: What specific minimum and maximum screen-space dimensions (in pixels) should be enforced for train models? → A: Min: 12px, Max: 40px height
- Q: How should line color be indicated for trains? → A: Show colored outline on hover only (not permanent coloring)
- Q: What color should the hover outline use? → A: Line's brand color from RodaliesLine data

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Spatial Separation at High Zoom (Priority: P1)

When multiple trains from different lines are at the same location (e.g., busy station), users need to see them separated side-by-side when zooming in. This prevents visual overlap and allows users to count and distinguish individual trains.

**Why this priority**: This is the core problem to solve. Currently, overlapping trains are indistinguishable even though the railway lines below them have different colors. Spatial separation makes each train individually visible and clickable.

**Independent Test**: Can be fully tested by finding a location with 3+ trains from different lines, zooming from level 10 to 17, and verifying trains spread out horizontally as zoom increases. Delivers immediate value by making overlapping trains distinguishable.

**Acceptance Scenarios**:

1. **Given** 3 trains from different lines (R1, R2, R3) are at the same station, **When** I view at zoom level 10, **Then** trains are closely positioned but visible

2. **Given** the same 3 trains at the station, **When** I zoom in to level 16, **Then** trains are spread out side-by-side with clear gaps between them (~2-3 meters separation)

3. **Given** trains are spatially separated at high zoom, **When** I zoom back out to level 10, **Then** trains smoothly transition back to closer positioning

---

### User Story 2 - Zoom-Responsive Train Sizing (Priority: P1)

Users need trains to maintain appropriate visual size as they zoom in and out of the map. At high zoom levels (close view), trains should not become disproportionately large and block the view. At low zoom levels (overview), trains should remain visible and not become too small to see.

**Why this priority**: This is equally critical to spatial separation. Without zoom-responsive sizing, trains become too large at high zoom (blocking the view) or too small at low zoom (invisible). Combined with spatial separation, this ensures trains remain usable across all zoom levels.

**Independent Test**: Can be tested by zooming from minimum to maximum zoom levels and verifying that train models maintain appropriate screen-space size throughout. Delivers value by ensuring trains are always visible but never obstructive.

**Acceptance Scenarios**:

1. **Given** I am viewing the map at the default zoom level, **When** I zoom in to view a specific station area, **Then** train models maintain a consistent screen-space size (not growing exponentially with zoom level)

2. **Given** I am viewing the map at maximum zoom (closest view), **When** I observe train positions, **Then** trains remain at an appropriate size that doesn't obscure the map details or overwhelm the viewport

3. **Given** I am viewing the overview of the entire Rodalies network at minimum zoom, **When** I look for active trains, **Then** trains remain visible and recognizable (not shrinking to invisible pixels)

4. **Given** I zoom smoothly from minimum to maximum zoom, **When** observing train size changes, **Then** the size transition appears smooth and natural without jarring jumps or sudden changes

---

### User Story 3 - Line Identification on Hover (Priority: P2)

When hovering over a train, users need a visual indicator showing which railway line the train belongs to. This helps identify trains when they are spatially separated or when checking individual train details.

**Why this priority**: This is a nice-to-have enhancement. The primary solutions (spatial separation + zoom sizing) solve the core overlap problem. Hover outline adds polish by making line identification explicit when users inspect a specific train.

**Independent Test**: Can be tested by hovering over trains from different lines and verifying that each train shows its line's brand color as an outline. Delivers value by providing on-demand line identification without cluttering the default view.

**Acceptance Scenarios**:

1. **Given** I am viewing trains on the map, **When** I hover over an R1 train, **Then** a light blue (#7DBCEC) outline appears around the train model

2. **Given** an R2 train with outline visible, **When** I move my cursor away, **Then** the green outline disappears smoothly

3. **Given** I hover over a train with unmapped route, **When** viewing the outline, **Then** a neutral gray (#CCCCCC) outline appears as fallback

---

### Edge Cases

- **What happens when a train's route cannot be mapped to a known line color?**
  The hover outline uses light gray (#CCCCCC) as fallback to ensure the outline is still visible.

- **What happens at extreme zoom levels beyond the typical range?**
  The system clamps train sizes to minimum (12 pixels) and maximum (40 pixels) screen-space height to prevent either invisible trains or trains that fill the entire screen.

- **How does spatial separation behave with only 1-2 trains at a location?**
  The lateral offset system applies consistently (hash-based bucket assignment), so even single trains have deterministic positions. The offset becomes more visually apparent only at high zoom.

- **What happens when zooming rapidly between levels?**
  Scale and lateral offset transitions should be smooth without jarring jumps. Cache invalidation ensures recalculation only when zoom bucket changes (0.1 increments).

- **How does hover outline interact with train click functionality?**
  Hover outline is purely visual - existing click detection and TrainInfoPanel continue to work unchanged. Outline appears on hover, remains while info panel is open.

## Requirements *(mandatory)*

### Functional Requirements

**Spatial Separation (Priority P1)**:

- **FR-001**: System MUST increase lateral offset distance for trains at the same location when zoom level exceeds 14

- **FR-002**: System MUST apply zoom-responsive lateral offset smoothly, transitioning from base offset (1.6m) to enhanced offset (2.4m or greater)

- **FR-003**: System MUST maintain deterministic offset positioning (hash-based bucket assignment) so trains don't jump randomly when zooming

**Zoom-Responsive Sizing (Priority P1)**:

- **FR-004**: System MUST implement zoom-responsive sizing that keeps trains at a consistent screen-space size regardless of map zoom level

- **FR-005**: System MUST enforce minimum (12 pixels) and maximum (40 pixels) screen-space height for train models to prevent extreme sizes at unusual zoom levels

- **FR-006**: Train size scaling MUST apply smoothly across zoom transitions without jarring jumps or sudden changes

**Hover Outline (Priority P2)**:

- **FR-007**: System MUST display a colored outline around train models on hover, using the line's brand color from RodaliesLine data

- **FR-008**: System MUST maintain accurate color-to-line mapping by extracting the line code from each train's `routeId` and matching it to the corresponding line's brand color

- **FR-009**: System MUST provide a fallback outline color of light gray (#CCCCCC) for trains whose route cannot be mapped to a known line

**Performance & Compatibility**:

- **FR-010**: System MUST maintain train hover and click detection accuracy across all zoom levels and size scales

- **FR-011**: Spatial separation, sizing, and hover outline MUST not negatively impact rendering performance (maintain 30+ FPS target with 100+ trains)

### Key Entities

- **TrainMeshData**: Internal metadata structure tracking each train's Three.js mesh, lateral offset index, base scale, and position. Will be extended with:
  - `screenSpaceScale`: Current zoom-responsive scale multiplier
  - `lastZoomBucket`: Quantized zoom level for cache invalidation
  - `hoverOutlineVisible`: Boolean flag for hover state

- **TrainPosition**: API data containing train location and route information. The `routeId` field (e.g., "R1_MOLINS_MACANET") is parsed to extract the line code for determining:
  - Spatial separation grouping (trains on same line)
  - Hover outline color lookup

- **RodaliesLine**: Static data containing line definitions including `brand_color` (hex without #). Used for:
  - Hover outline color (maps line code → brand color)
  - No permanent coloring of trains (trains remain their original model appearance)

- **TrainMesh**: Three.js Group containing the 3D train model. Must support:
  - Dynamic scale modification (mesh.scale) for zoom-responsive sizing
  - Outline/glow effect for hover state (via outline shader or duplicate geometry)
  - Lateral position offset based on zoom level

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At zoom level 16, trains at the same location are separated by at least 2 meters (visible gap of 10+ pixels between models)

- **SC-002**: Train models maintain screen-space height between 12-40 pixels at all zoom levels (5-17), preventing visibility or obstruction issues

- **SC-003**: Spatial separation transitions smoothly when zooming from level 10 to 17 without jarring position jumps (measured by visual inspection and user testing)

- **SC-004**: System maintains 30+ FPS performance with 100+ trains active simultaneously, including spatial separation, zoom scaling, and hover outlines

- **SC-005**: Users can distinguish and click individual trains at busy stations when zoomed in (measured by task completion rate >95%)

- **SC-006**: Hover outline appears within 100ms of cursor entering train model and disappears within 100ms of cursor leaving (measured by event timing)
