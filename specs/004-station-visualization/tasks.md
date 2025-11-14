# Tasks: Station Visualization and Interaction

**Input**: Design documents from `/specs/004-station-visualization/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Tests are included in this implementation as the spec requires comprehensive testing strategy (unit, component, E2E).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Web app (monorepo)**: `apps/web/src/`, `apps/web/e2e/`
- All paths are relative to repository root

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create foundational directory structure and configuration

- [ ] T001 Create stations feature directory at apps/web/src/features/stations/
- [ ] T002 Create stations library directory at apps/web/src/lib/stations/
- [ ] T003 [P] Create stations hooks directory at apps/web/src/features/stations/hooks/
- [ ] T004 [P] Verify Station.geojson exists at apps/web/public/rodalies_data/Station.geojson

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core utilities and state management that ALL user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### State Management Extensions

- [ ] T005 Extend MapUIState interface with selectedStationId and stationLoadError in apps/web/src/state/map/types.ts
- [ ] T006 Extend MapActions interface with selectStation() and retryStationLoad() in apps/web/src/state/map/types.ts
- [ ] T007 Add SELECT_STATION reducer case to mapStateReducer in apps/web/src/state/map/MapStateProvider.tsx
- [ ] T008 Add SET_STATION_LOAD_ERROR reducer case to mapStateReducer in apps/web/src/state/map/MapStateProvider.tsx
- [ ] T009 Implement selectStation action in MapActionsContext in apps/web/src/state/map/MapStateProvider.tsx
- [ ] T010 Implement retryStationLoad action in MapActionsContext in apps/web/src/state/map/MapStateProvider.tsx

### Core Utilities

- [ ] T011 [P] Implement calculateRadialOffsets function in apps/web/src/lib/stations/markerPositioning.ts
- [ ] T012 [P] Implement clusterByProximity helper function in apps/web/src/lib/stations/markerPositioning.ts
- [ ] T013 [P] Implement getStationMarkerStyles function in apps/web/src/lib/stations/markerStyles.ts
- [ ] T014 [P] Implement getMultiLineInnerCircleStyles function in apps/web/src/lib/stations/markerStyles.ts

### Unit Tests for Utilities

- [ ] T015 [P] Write unit tests for calculateRadialOffsets in apps/web/src/lib/stations/markerPositioning.test.ts
- [ ] T016 [P] Write unit tests for clusterByProximity in apps/web/src/lib/stations/markerPositioning.test.ts
- [ ] T017 [P] Write unit tests for marker style functions in apps/web/src/lib/stations/markerStyles.test.ts
- [ ] T018 [P] Write unit tests for MapStateProvider station actions in apps/web/src/state/map/MapStateProvider.test.tsx

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - View Stations on Map (Priority: P1) 🎯 MVP

**Goal**: Users can see all Rodalies stations displayed on the map as visual markers with proper positioning, zoom-responsive sizing, and visual differentiation for multi-line stations.

**Independent Test**: Load the map and verify that 200+ station markers appear at correct geographic coordinates with proper visual styling. Stations belonging to selected lines are prominently displayed.

### E2E Tests for User Story 1

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T019 [P] [US1] Write E2E test for "all stations appear on map load" in apps/web/e2e/stations.spec.ts
- [ ] T020 [P] [US1] Write E2E test for "station markers scale with zoom level" in apps/web/e2e/stations.spec.ts
- [ ] T021 [P] [US1] Write E2E test for "multi-line stations show concentric circles" in apps/web/e2e/stations.spec.ts
- [ ] T022 [P] [US1] Write E2E test for "stations filter by highlighted lines" in apps/web/e2e/stations.spec.ts

### Implementation for User Story 1

- [ ] T023 [P] [US1] Create useStationMarkers hook in apps/web/src/features/stations/hooks/useStationMarkers.ts
- [ ] T024 [US1] Implement StationLayer component in apps/web/src/features/stations/StationLayer.tsx (depends on T023)
- [ ] T025 [US1] Add station data loading logic to StationLayer with error handling in apps/web/src/features/stations/StationLayer.tsx
- [ ] T026 [US1] Add Mapbox GL source creation for stations in StationLayer in apps/web/src/features/stations/StationLayer.tsx
- [ ] T027 [US1] Add single-line station circle layer in StationLayer in apps/web/src/features/stations/StationLayer.tsx
- [ ] T028 [US1] Add multi-line station outer circle layer in StationLayer in apps/web/src/features/stations/StationLayer.tsx
- [ ] T029 [US1] Add multi-line station inner circle layer in StationLayer in apps/web/src/features/stations/StationLayer.tsx
- [ ] T030 [US1] Integrate radial offset positioning in StationLayer in apps/web/src/features/stations/StationLayer.tsx
- [ ] T031 [US1] Apply line highlighting filters to station layers in StationLayer in apps/web/src/features/stations/StationLayer.tsx
- [ ] T032 [US1] Add StationLayer to RodaliesMapView in apps/web/src/features/map/RodaliesMapView.tsx
- [ ] T033 [US1] Add error banner for station load failures in RodaliesMapView in apps/web/src/features/map/RodaliesMapView.tsx

### Component Tests for User Story 1

- [ ] T034 [P] [US1] Write component test for StationLayer marker rendering in apps/web/src/features/stations/StationLayer.test.tsx
- [ ] T035 [P] [US1] Write component test for radial offset application in apps/web/src/features/stations/StationLayer.test.tsx
- [ ] T036 [P] [US1] Write component test for line highlighting integration in apps/web/src/features/stations/StationLayer.test.tsx

**Checkpoint**: At this point, User Story 1 should be fully functional - 200+ stations visible on map with proper styling, positioning, and filtering

---

## Phase 4: User Story 2 - Click Station for Details (Priority: P2)

**Goal**: Users can click or tap any station marker to view detailed information (name, code, serving lines) in a fixed detail panel that works on desktop and mobile.

**Independent Test**: Click any station marker and verify the information panel displays correct data with line badges. Panel closes via X button, outside click, or Escape key.

### E2E Tests for User Story 2

- [ ] T037 [P] [US2] Write E2E test for "clicking station opens detail panel" in apps/web/e2e/stations.spec.ts
- [ ] T038 [P] [US2] Write E2E test for "panel shows station name, code, and lines" in apps/web/e2e/stations.spec.ts
- [ ] T039 [P] [US2] Write E2E test for "clicking another station updates panel" in apps/web/e2e/stations.spec.ts
- [ ] T040 [P] [US2] Write E2E test for "panel closes on outside click and escape" in apps/web/e2e/stations.spec.ts
- [ ] T041 [P] [US2] Write E2E test for "rapid station clicks show only most recent" in apps/web/e2e/stations.spec.ts

### Implementation for User Story 2

- [ ] T042 [P] [US2] Create StationInfoPanelDesktop component in apps/web/src/features/stations/StationInfoPanelDesktop.tsx
- [ ] T043 [P] [US2] Create StationInfoPanelMobile component in apps/web/src/features/stations/StationInfoPanelMobile.tsx
- [ ] T044 [US2] Create StationInfoPanel wrapper component in apps/web/src/features/stations/StationInfoPanel.tsx (depends on T042, T043)
- [ ] T045 [US2] Add Radix Dialog integration to desktop panel in apps/web/src/features/stations/StationInfoPanelDesktop.tsx
- [ ] T046 [US2] Add Radix Dialog integration to mobile panel in apps/web/src/features/stations/StationInfoPanelMobile.tsx
- [ ] T047 [US2] Implement line badge rendering with colors in StationInfoPanel components
- [ ] T048 [US2] Add click handler to StationLayer for station selection in apps/web/src/features/stations/StationLayer.tsx
- [ ] T049 [US2] Integrate StationInfoPanel into RodaliesMapView in apps/web/src/features/map/RodaliesMapView.tsx
- [ ] T050 [US2] Add station data fetch logic based on selectedStationId in RodaliesMapView in apps/web/src/features/map/RodaliesMapView.tsx
- [ ] T051 [US2] Implement rapid click cancellation logic (FR-016) in MapStateProvider

### Component Tests for User Story 2

- [ ] T052 [P] [US2] Write component test for StationInfoPanelDesktop rendering in apps/web/src/features/stations/StationInfoPanelDesktop.test.tsx
- [ ] T053 [P] [US2] Write component test for StationInfoPanelMobile rendering in apps/web/src/features/stations/StationInfoPanelMobile.test.tsx
- [ ] T054 [P] [US2] Write component test for line badge display in apps/web/src/features/stations/StationInfoPanel.test.tsx
- [ ] T055 [P] [US2] Write component test for panel close interactions in apps/web/src/features/stations/StationInfoPanel.test.tsx

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently - markers visible AND clickable with detail panel

---

## Phase 5: User Story 3 - Hover Station Preview (Priority: P3)

**Goal**: Users can hover over station markers on desktop to see a quick preview tooltip with station name (and line count after 500ms hover).

**Independent Test**: Move cursor over various stations on desktop and verify tooltip appears within 100ms showing station name, then disappears within 200ms of cursor leaving.

### E2E Tests for User Story 3

- [ ] T056 [P] [US3] Write E2E test for "hovering shows tooltip with station name" in apps/web/e2e/stations.spec.ts (desktop only)
- [ ] T057 [P] [US3] Write E2E test for "tooltip disappears on mouse leave" in apps/web/e2e/stations.spec.ts
- [ ] T058 [P] [US3] Write E2E test for "tooltip shows line count after 500ms" in apps/web/e2e/stations.spec.ts
- [ ] T059 [P] [US3] Write E2E test for "no tooltip on mobile devices" in apps/web/e2e/stations.spec.ts

### Implementation for User Story 3

- [ ] T060 [P] [US3] Create useStationHover hook in apps/web/src/features/stations/hooks/useStationHover.ts
- [ ] T061 [US3] Integrate useStationHover into StationLayer in apps/web/src/features/stations/StationLayer.tsx
- [ ] T062 [US3] Add Mapbox GL Popup initialization for hover tooltips in useStationHover
- [ ] T063 [US3] Add mouseenter event handler with 200ms debounce in useStationHover
- [ ] T064 [US3] Add mouseleave event handler for tooltip dismissal in useStationHover
- [ ] T065 [US3] Add 500ms delayed line count display logic in useStationHover
- [ ] T066 [US3] Add media query check to disable hover on touch devices in useStationHover
- [ ] T067 [US3] Style hover tooltip with Tailwind classes for consistency

### Component Tests for User Story 3

- [ ] T068 [P] [US3] Write component test for useStationHover hook in apps/web/src/features/stations/hooks/useStationHover.test.ts
- [ ] T069 [P] [US3] Write component test for tooltip timing (100ms appear, 200ms dismiss) in useStationHover.test.ts
- [ ] T070 [P] [US3] Write component test for desktop-only behavior in useStationHover.test.ts

**Checkpoint**: All user stories should now be independently functional - view, click, and hover all working

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories and final quality checks

### Performance & Optimization

- [ ] T071 [P] Verify 30+ FPS performance with 200+ stations across zoom levels
- [ ] T072 [P] Profile and optimize radial offset calculation if needed
- [ ] T073 [P] Verify detail panel displays within 500ms (SC-004)
- [ ] T074 [P] Verify hover tooltip appears within 100ms (SC-005)

### Error Handling & Edge Cases

- [ ] T075 [P] Add handling for stations with missing code field (display "N/A")
- [ ] T076 [P] Add handling for stations serving unloaded lines (graceful fallback)
- [ ] T077 [P] Verify error banner retry functionality works correctly

### Accessibility & Responsiveness

- [ ] T078 [P] Verify panel is readable on 320px viewport width (SC-008)
- [ ] T079 [P] Test keyboard navigation for panel close (Escape key)
- [ ] T080 [P] Verify ARIA attributes on dialog components

### Documentation & Validation

- [ ] T081 [P] Update CLAUDE.md with station feature implementation notes
- [ ] T082 Run full test suite (unit + component + E2E) and verify all pass
- [ ] T083 Visual QA: Verify all acceptance scenarios from spec.md
- [ ] T084 Run quickstart.md validation steps
- [ ] T085 Performance validation: Record FPS metrics with 200+ stations

### Code Quality

- [ ] T086 [P] Run ESLint and fix any issues in station feature files
- [ ] T087 [P] Review and refactor for code clarity and maintainability
- [ ] T088 [P] Add JSDoc comments to public interfaces

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-5)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Phase 6)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Extends US1 but independently testable
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Extends US1 but independently testable

### Within Each User Story

- E2E tests MUST be written and FAIL before implementation
- Component tests can be written alongside implementation
- Core implementation tasks have internal dependencies (e.g., hooks before components)
- Story complete before moving to next priority

### Parallel Opportunities

**Phase 1 (Setup)**: All tasks can run in parallel

**Phase 2 (Foundational)**:
- State management tasks (T005-T010) are sequential
- Utility tasks (T011-T014) can all run in parallel
- Test tasks (T015-T018) can all run in parallel after utilities complete

**Phase 3 (User Story 1)**:
- E2E tests (T019-T022) can all run in parallel
- Component tests (T034-T036) can all run in parallel
- Implementation has dependencies (hook → component → integration)

**Phase 4 (User Story 2)**:
- E2E tests (T037-T041) can all run in parallel
- Desktop and mobile panel components (T042-T043) can run in parallel
- Component tests (T052-T055) can all run in parallel

**Phase 5 (User Story 3)**:
- E2E tests (T056-T059) can all run in parallel
- Implementation is mostly sequential (hook → integration → styling)
- Component tests (T068-T070) can all run in parallel

**Phase 6 (Polish)**: Most tasks can run in parallel

---

## Parallel Example: User Story 1

```bash
# Launch all E2E tests for User Story 1 together:
Task T019: "Write E2E test for 'all stations appear on map load'"
Task T020: "Write E2E test for 'station markers scale with zoom level'"
Task T021: "Write E2E test for 'multi-line stations show concentric circles'"
Task T022: "Write E2E test for 'stations filter by highlighted lines'"

# Launch all component tests for User Story 1 together (after implementation):
Task T034: "Write component test for StationLayer marker rendering"
Task T035: "Write component test for radial offset application"
Task T036: "Write component test for line highlighting integration"
```

---

## Parallel Example: User Story 2

```bash
# Launch desktop and mobile panel components in parallel:
Task T042: "Create StationInfoPanelDesktop component"
Task T043: "Create StationInfoPanelMobile component"

# Launch all E2E tests for User Story 2 together:
Task T037: "Write E2E test for 'clicking station opens detail panel'"
Task T038: "Write E2E test for 'panel shows station name, code, and lines'"
Task T039: "Write E2E test for 'clicking another station updates panel'"
Task T040: "Write E2E test for 'panel closes on outside click and escape'"
Task T041: "Write E2E test for 'rapid station clicks show only most recent'"
```

---

## Parallel Example: Foundational Phase

```bash
# Launch all utility implementations in parallel:
Task T011: "Implement calculateRadialOffsets function"
Task T012: "Implement clusterByProximity helper function"
Task T013: "Implement getStationMarkerStyles function"
Task T014: "Implement getMultiLineInnerCircleStyles function"

# After utilities complete, launch all utility tests in parallel:
Task T015: "Write unit tests for calculateRadialOffsets"
Task T016: "Write unit tests for clusterByProximity"
Task T017: "Write unit tests for marker style functions"
Task T018: "Write unit tests for MapStateProvider station actions"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T004)
2. Complete Phase 2: Foundational (T005-T018) - **CRITICAL - blocks all stories**
3. Complete Phase 3: User Story 1 (T019-T036)
4. **STOP and VALIDATE**: Test User Story 1 independently - verify 200+ stations appear with correct styling
5. Deploy/demo if ready - this is a complete MVP

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP: visible stations!)
3. Add User Story 2 → Test independently → Deploy/Demo (Add: interactive detail panel)
4. Add User Story 3 → Test independently → Deploy/Demo (Add: hover tooltips)
5. Add Polish → Final release
6. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. **Phase 1 & 2**: Team completes together (foundational work)
2. **Once Foundational is done**:
   - Developer A: User Story 1 (T019-T036)
   - Developer B: User Story 2 (T037-T055)
   - Developer C: User Story 3 (T056-T070)
3. Stories complete and integrate independently
4. Team reunites for Polish (Phase 6)

### TDD Workflow (Per Story)

1. Write all E2E tests for story - they MUST fail
2. Write failing unit/component tests as you go
3. Implement features to make tests pass (Red → Green → Refactor)
4. Verify story independently before moving to next

---

## Notes

- **[P] tasks** = different files, no dependencies - can run in parallel
- **[Story] label** maps task to specific user story for traceability
- Each user story should be independently completable and testable
- **Verify E2E tests fail before implementing** (TDD discipline)
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- **Performance targets**: 30+ FPS, <500ms panel, <100ms tooltip
- **Accessibility**: ARIA attributes, keyboard nav, 320px+ viewport support
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence

---

## Task Summary

**Total Tasks**: 88

**Breakdown by Phase**:
- Phase 1 (Setup): 4 tasks
- Phase 2 (Foundational): 14 tasks (10 implementation + 4 tests)
- Phase 3 (User Story 1): 18 tasks (4 E2E tests + 11 implementation + 3 component tests)
- Phase 4 (User Story 2): 19 tasks (5 E2E tests + 10 implementation + 4 component tests)
- Phase 5 (User Story 3): 15 tasks (4 E2E tests + 8 implementation + 3 component tests)
- Phase 6 (Polish): 18 tasks

**Parallelizable Tasks**: 42 tasks marked with [P]

**Independent Test Criteria**:
- **US1**: Load map → Verify 200+ stations appear with correct styling and positioning
- **US2**: Click any station → Verify panel opens with correct data and closes properly
- **US3**: Hover over stations (desktop) → Verify tooltip appears/disappears with correct timing

**MVP Scope**: Phase 1 + Phase 2 + Phase 3 (User Story 1) = 36 tasks for minimum viable product
