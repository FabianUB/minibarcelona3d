# Tasks: Real-Time Train Tracking with 3D Visualization

**Input**: Design documents from `/specs/002-realtime-train-tracking/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.yaml

**Organization**: Tasks follow the phased approach (API → 2D → 3D → Features) aligned with user story priorities.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story/phase this task belongs to (Phase A, Phase B, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

- **Backend**: `apps/api/` (Go)
- **Frontend**: `apps/web/src/` (React/TypeScript)
- **Tests**: `apps/api/tests/`, `apps/web/e2e/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and dependency installation

- [X] T001 Install Go dependencies (pgx/v5, pgx/v5/pgxpool) in apps/api/go.mod
- [X] T002 [P] Verify PostgreSQL database connection and rt_rodalies_vehicle_current table exists
- [X] T003 [P] Create directory structure for backend: apps/api/models/, apps/api/handlers/, apps/api/repository/, apps/api/tests/
- [X] T004 [P] Create directory structure for frontend: apps/web/src/features/trains/, apps/web/src/lib/api/, apps/web/src/types/, apps/web/src/state/trains/

---

## Phase 2: Foundational - Phase A (Go API + PostgreSQL)

**Purpose**: Backend API that serves train data - BLOCKS all frontend work

**⚠️ CRITICAL**: Frontend cannot begin until API endpoints are working and testable

**Mapping**: This implements the data layer for User Story 1 (P1)

### Integration Tests (TDD: Write & Verify Fail First)

**⚠️ TDD REQUIREMENT**: These tests MUST be written first and MUST fail before implementation begins.

- [X] T005 [P] [Phase A] Create integration test for GetAllTrains in apps/api/tests/integration/trains_test.go (expect failure - no implementation yet)
- [X] T006 [P] [Phase A] Create integration test for GetTrainByKey in apps/api/tests/integration/trains_test.go (expect failure - no implementation yet)
- [X] T007 [Phase A] Create performance test: verify API responds in <100ms for ~100 trains in apps/api/tests/integration/trains_test.go (expect failure)

**Checkpoint**: All tests written and failing (RED state) - ready to implement

### Backend Models

- [X] T008 [P] [Phase A] Create Train model struct in apps/api/models/train.go mapping to rt_rodalies_vehicle_current columns
- [X] T009 [P] [Phase A] Create TrainPosition model struct in apps/api/models/train.go for lightweight polling
- [X] T010 [P] [Phase A] Add Validate() method to Train model in apps/api/models/train.go

### Database Repository

- [X] T011 [Phase A] Create TrainRepository struct with pgxpool connection in apps/api/repository/postgres.go
- [X] T012 [Phase A] Implement GetAllTrains() query method in apps/api/repository/postgres.go
- [X] T013 [P] [Phase A] Implement GetTrainByKey(vehicleKey) query method in apps/api/repository/postgres.go
- [X] T014 [P] [Phase A] Implement GetTrainsByRoute(routeId) query method in apps/api/repository/postgres.go
- [X] T015 [Phase A] Implement GetAllTrainPositions() lightweight query in apps/api/repository/postgres.go

### HTTP Handlers

- [X] T016 [Phase A] Create TrainHandler struct in apps/api/handlers/trains.go
- [X] T017 [P] [Phase A] Implement GetAllTrains handler (GET /api/trains) in apps/api/handlers/trains.go
- [X] T018 [P] [Phase A] Implement GetTrainByKey handler (GET /api/trains/{vehicleKey}) in apps/api/handlers/trains.go
- [X] T019 [P] [Phase A] Implement GetAllTrainPositions handler (GET /api/trains/positions) in apps/api/handlers/trains.go

### API Wiring

- [X] T020 [Phase A] Update apps/api/main.go to initialize database connection from DATABASE_URL env var
- [X] T021 [Phase A] Wire train routes to TrainHandler in apps/api/main.go
- [X] T022 [Phase A] Add health check endpoint (GET /health) that tests database connectivity in apps/api/main.go
- [X] T023 [Phase A] Configure CORS for http://localhost:5173 origin in apps/api/main.go

### Verify Tests Pass (Green)

- [X] T024 [Phase A] Run integration tests - verify all pass (GREEN state achieved)

**Checkpoint**: Run API locally, verify /api/trains returns JSON with real train data AND all tests pass

---

## Phase 3: User Story 1 - View Real-Time Train Positions (Priority: P1) 🎯 MVP

**Goal**: Display trains as 2D markers on map with real-time updates (Phase B)

**Independent Test**: Load map, see orange markers at train positions that update every 30 seconds

**Acceptance Criteria**:
- ✅ Markers appear at GPS coordinates from API
- ✅ Markers update position every 30 seconds
- ✅ Multiple trains on same line are individually visible
- ✅ Click marker logs train ID to console (prep for US2)

### Frontend Types

- [ ] T025 [P] [US1] Create Train interface in apps/web/src/types/trains.ts matching backend JSON
- [ ] T026 [P] [US1] Create TrainPosition interface in apps/web/src/types/trains.ts
- [ ] T027 [P] [US1] Create VehicleStatus type in apps/web/src/types/trains.ts

### API Client

- [ ] T028 [P] [US1] Create fetchAllTrains() function in apps/web/src/lib/api/trains.ts
- [ ] T029 [P] [US1] Create fetchTrainPositions() function in apps/web/src/lib/api/trains.ts
- [ ] T030 [P] [US1] Create fetchTrainByKey(vehicleKey) function in apps/web/src/lib/api/trains.ts
- [ ] T031 [US1] Add error handling and retry logic to API client in apps/web/src/lib/api/trains.ts

### Train Markers Component

- [ ] T032 [US1] Create TrainMarkers.tsx component in apps/web/src/features/trains/TrainMarkers.tsx
- [ ] T033 [US1] Implement useEffect to fetch trains on mount and poll every 30s in TrainMarkers.tsx
- [ ] T034 [US1] Create Mapbox Marker elements with styling (12px orange circles) in TrainMarkers.tsx
- [ ] T035 [US1] Implement marker position updates when train data changes in TrainMarkers.tsx
- [ ] T036 [US1] Add click event handler that logs vehicleKey to console in TrainMarkers.tsx
- [ ] T037 [US1] Implement marker cleanup on unmount in TrainMarkers.tsx

### Map Integration

- [ ] T038 [US1] Import and render TrainMarkers component in apps/web/src/features/map/MapCanvas.tsx
- [ ] T039 [US1] Pass map instance to TrainMarkers after map initialization in MapCanvas.tsx

### E2E Test

- [ ] T040 [US1] Create train-markers.spec.ts in apps/web/e2e/ that verifies markers appear and update

**Checkpoint Phase B Complete**:
- Start both API and frontend
- Open browser to http://localhost:5173
- Verify orange dots appear at train positions
- Wait 30s, verify dots move
- Click dot, verify console.log shows vehicle key

---

## Phase 4: User Story 1 Enhanced - Upgrade to 3D Models (Phase C)

**Goal**: Replace 2D markers with Three.js 3D train models

**Independent Test**: Load map, see 3D train models oriented toward next station, updating smoothly

**Acceptance Criteria**:
- ✅ 3D models render on top of line geometry
- ✅ Models oriented based on next station bearing
- ✅ Smooth position interpolation between updates
- ✅ Click detection works on 3D models
- ✅ 60fps with 100+ trains

### Geometry Utilities

- [ ] T041 [P] [US1] Create calculateBearing() function using Haversine formula in apps/web/src/lib/trains/geometry.ts
- [ ] T042 [P] [US1] Create interpolatePosition() function for smooth movement in apps/web/src/lib/trains/geometry.ts

### Three.js Setup

- [ ] T043 [US1] Create TrainLayer3D.tsx component in apps/web/src/features/trains/TrainLayer3D.tsx
- [ ] T044 [US1] Implement Mapbox Custom Layer interface with Three.js renderer in TrainLayer3D.tsx
- [ ] T045 [US1] Create simple 3D train geometry (box with texture) in TrainLayer3D.tsx
- [ ] T046 [US1] Implement train model creation for each vehicle in TrainLayer3D.tsx
- [ ] T047 [US1] Calculate bearing to next station and apply rotation in TrainLayer3D.tsx
- [ ] T048 [US1] Implement position interpolation animation loop in TrainLayer3D.tsx
- [ ] T049 [US1] Add raycasting for click detection on 3D models in TrainLayer3D.tsx

### Map Layer Integration

- [ ] T050 [US1] Add TrainLayer3D as Mapbox Custom Layer with correct beforeId in MapCanvas.tsx
- [ ] T051 [US1] Remove or conditionally disable TrainMarkers (2D) component in MapCanvas.tsx

### Performance

- [ ] T052 [US1] Test rendering performance with 100 train models, verify 60fps
- [ ] T053 [US1] Add performance monitoring and frame time logging in TrainLayer3D.tsx

**Checkpoint Phase C Complete**:
- Verify 3D models render instead of 2D markers
- Models point toward next station
- Smooth movement between position updates
- Click works on 3D models
- No performance degradation

---

## Phase 5: User Story 2 - Access Train Information Panel (Priority: P2)

**Goal**: Click train to open info panel showing route, stops, and delays

**Independent Test**: Click any train → panel opens with route ID, delay info, stop list

**Acceptance Criteria**:
- ✅ Panel opens within 500ms of click
- ✅ Displays route identifier and direction
- ✅ Shows current delay prominently
- ✅ Lists all stops with scheduled times
- ✅ Close panel on outside click or close button

### State Management

- [ ] T054 [P] [US2] Create TrainStateProvider.tsx with Context + Reducer in apps/web/src/state/trains/TrainStateProvider.tsx
- [ ] T055 [P] [US2] Define TrainState interface (selectedTrain, isPanelOpen) in apps/web/src/state/trains/types.ts
- [ ] T056 [P] [US2] Define TrainActions (selectTrain, closePanel) in apps/web/src/state/trains/types.ts
- [ ] T057 [US2] Implement reducer with select-train and close-panel actions in TrainStateProvider.tsx
- [ ] T058 [US2] Create useTrainState(), useTrainActions() hooks in apps/web/src/state/trains/hooks.ts

### Info Panel Component

- [ ] T059 [US2] Create TrainInfoPanel.tsx component in apps/web/src/features/trains/TrainInfoPanel.tsx
- [ ] T060 [US2] Implement panel layout with route header and close button in TrainInfoPanel.tsx
- [ ] T061 [US2] Display vehicle label, route ID from selected train in TrainInfoPanel.tsx
- [ ] T062 [US2] Implement formatDelay() helper and display delay prominently in TrainInfoPanel.tsx
- [ ] T063 [US2] Add placeholder for stop list (will be implemented in US3) in TrainInfoPanel.tsx
- [ ] T064 [US2] Add click-outside detection to close panel in TrainInfoPanel.tsx
- [ ] T065 [US2] Add escape key handler to close panel in TrainInfoPanel.tsx

### Click Integration

- [ ] T066 [US2] Update TrainLayer3D click handler to call selectTrain() action
- [ ] T067 [US2] Fetch full train details on selection if needed in TrainInfoPanel.tsx

### Styling

- [ ] T068 [P] [US2] Create panel CSS with slide-in animation in apps/web/src/features/trains/TrainInfoPanel.module.css
- [ ] T069 [P] [US2] Add responsive design for mobile in TrainInfoPanel.module.css

### State Provider Integration

- [ ] T070 [US2] Wrap MapCanvas with TrainStateProvider in apps/web/src/App.tsx
- [ ] T071 [US2] Render TrainInfoPanel in MapCanvas when panel is open

**Checkpoint US2 Complete**:
- Click train → panel slides in from right
- Shows route, vehicle label, delay
- Click outside or ESC → panel closes
- Performance: Opens in <500ms

---

## Phase 6: User Story 3 - View Stop Details and Status (Priority: P3)

**Goal**: Show complete stop list with status (completed/current/upcoming) and actual times

**Independent Test**: Open train panel → see stop list with color-coded status and delay info

**Acceptance Criteria**:
- ✅ Past stops marked complete with actual times
- ✅ Current stop highlighted
- ✅ Future stops show scheduled times
- ✅ Delayed stops show both scheduled and actual with difference

### Backend Extension (if needed)

- [ ] T072 [US3] Assess if rt_rodalies_vehicle_current provides enough stop data or if additional query needed
- [ ] T073 [US3] If needed: Create GetTripDetails(tripId) endpoint in apps/api/handlers/trains.go
- [ ] T074 [US3] If needed: Add TripDetails and StopTime models in apps/api/models/train.go

### Frontend Types

- [ ] T075 [P] [US3] Create StopTime interface in apps/web/src/types/trains.ts
- [ ] T076 [P] [US3] Add stops array to train data structure

### Stop List Component

- [ ] T077 [US3] Create StopList.tsx component in apps/web/src/features/trains/StopList.tsx
- [ ] T078 [US3] Implement logic to determine stop status (completed/current/upcoming) in StopList.tsx
- [ ] T079 [US3] Render stop list with station names and times in StopList.tsx
- [ ] T080 [US3] Apply visual styling for completed stops (gray) in StopList.tsx
- [ ] T081 [US3] Apply visual styling for current stop (highlighted/bold) in StopList.tsx
- [ ] T082 [US3] Apply visual styling for upcoming stops (default) in StopList.tsx
- [ ] T083 [US3] Display actual vs scheduled times when different in StopList.tsx
- [ ] T084 [US3] Calculate and display delay duration per stop in StopList.tsx

### Integration

- [ ] T085 [US3] Replace placeholder stop list in TrainInfoPanel with StopList component
- [ ] T086 [US3] Add scrolling behavior for long stop lists in TrainInfoPanel.tsx

**Checkpoint US3 Complete**:
- Open panel → see full chronological stop list
- Past stops grayed out with actual times
- Current stop highlighted
- Future stops with scheduled times
- Delays clearly visible

---

## Phase 7: User Story 4 - Filter Trains by Line (Priority: P4)

**Goal**: Use existing legend to filter visible trains by selected lines

**Independent Test**: Select line in legend → only that line's trains visible

**Acceptance Criteria**:
- ✅ Line selection filters both API calls and rendering
- ✅ Multiple lines can be selected
- ✅ Info panel closes if filtered train hidden
- ✅ Filter persists during position updates

### Legend Integration

- [ ] T087 [US4] Review existing legend component from feature 001 at apps/web/src/features/legend/
- [ ] T088 [US4] Add hook to subscribe to line selection state in TrainLayer3D.tsx
- [ ] T089 [US4] Filter train data by selected routeIds before rendering in TrainLayer3D.tsx
- [ ] T090 [US4] Optionally: Optimize API calls to pass routeId filter in fetchTrainPositions()

### Panel Behavior

- [ ] T091 [US4] Implement logic to close panel when selected train filtered out in TrainStateProvider.tsx
- [ ] T092 [US4] Add watcher for line selection changes in TrainInfoPanel.tsx

### Visual Feedback

- [ ] T093 [US4] Add loading indicator when filter changes in TrainLayer3D.tsx
- [ ] T094 [P] [US4] Add counter showing N trains visible / total in map UI

**Checkpoint US4 Complete**:
- Select line → only those trains render
- Deselect line → trains disappear smoothly
- Multi-select works
- Panel behavior correct

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Final improvements affecting multiple user stories

### Error Handling

- [ ] T095 [P] Add error boundary component in apps/web/src/features/trains/ErrorBoundary.tsx
- [ ] T096 [P] Display user-friendly message when API unavailable in TrainMarkers or TrainLayer3D
- [ ] T097 Add stale data detection (polledAt > 60s ago) in TrainLayer3D.tsx
- [ ] T098 Add visual indicator for stale trains (gray out or pulse) in TrainLayer3D.tsx

### Loading States

- [ ] T099 [P] Add skeleton UI while initial train data loads in MapCanvas.tsx
- [ ] T100 [P] Add spinner in TrainInfoPanel while fetching trip details

### Performance

- [ ] T101 Implement connection pooling optimization if needed in apps/api/repository/postgres.go
- [ ] T102 Add API response caching headers in apps/api/handlers/trains.go
- [ ] T103 Profile Three.js rendering and optimize if needed in TrainLayer3D.tsx

### Documentation

- [ ] T104 [P] Update CLAUDE.md with train feature patterns and best practices
- [ ] T105 [P] Add API documentation to README in apps/api/
- [ ] T106 Validate quickstart.md instructions still work

### Testing

- [ ] T107 [P] Add E2E test for info panel interaction in apps/web/e2e/train-info-panel.spec.ts
- [ ] T108 [P] Add E2E test for line filtering in apps/web/e2e/train-filtering.spec.ts
- [ ] T109 Run full E2E test suite across all browsers (Chromium, Firefox, WebKit)

**Final Checkpoint**: All user stories work independently and together

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup)
    ↓
Phase 2 (Foundational - Phase A: Go API) ← BLOCKS ALL FRONTEND
    ↓
Phase 3 (US1: 2D Markers - Phase B) ← MVP COMPLETE HERE
    ↓
Phase 4 (US1 Enhanced: 3D Models - Phase C)
    ↓
Phase 5 (US2: Info Panel) ← Can start after Phase 3, independent of Phase 4
    ↓
Phase 6 (US3: Stop Details) ← Depends on Phase 5
    ↓
Phase 7 (US4: Filtering) ← Can start after Phase 3, parallel with Phases 5-6
    ↓
Phase 8 (Polish)
```

### Critical Path

**Fastest route to MVP** (Phase B with 2D markers):
1. Setup (T001-T004)
2. Phase A Backend (T005-T024)
3. Phase B Frontend US1 2D (T025-T040)
4. **MVP DELIVERABLE** ✅

**Full Feature** (with 3D):
5. Phase C 3D Upgrade (T041-T053)
6. Phase D Features: US2 (T054-T071), US3 (T072-T086), US4 (T087-T094)
7. Polish (T095-T109)

### Parallelization Opportunities

**Within Phase 2 (Backend)**:
- T005, T006 (integration tests) can run in parallel before implementation
- T008, T009, T010 (models) can run in parallel
- T013, T014 (repository methods) can run in parallel after T011-T012
- T017, T018, T019 (handlers) can run in parallel after T016
- T022, T023 (wiring) can run in parallel after T020-T021

**Within Phase 3 (US1 Frontend)**:
- T025, T026, T027 (types) can run in parallel
- T028, T029, T030 (API client) can run in parallel
- T041, T042 (geometry utils for Phase C) can run ahead in parallel

**Across User Stories** (if multiple developers):
- After Phase 4: US2, US3, US4 can proceed in parallel
- US2 and US4 are independent
- US3 depends on US2 completing

---

## Parallel Example: Phase 2 (Backend API)

```bash
# Launch all model tasks together:
Task: "Create Train model struct in apps/api/models/train.go"
Task: "Create TrainPosition model in apps/api/models/train.go"
Task: "Add Validate() method in apps/api/models/train.go"

# After repository init, launch all query methods:
Task: "Implement GetAllTrains() in apps/api/repository/postgres.go"
Task: "Implement GetTrainByKey() in apps/api/repository/postgres.go"
Task: "Implement GetTrainsByRoute() in apps/api/repository/postgres.go"

# Launch all handler implementations:
Task: "Implement GetAllTrains handler in apps/api/handlers/trains.go"
Task: "Implement GetTrainByKey handler in apps/api/handlers/trains.go"
Task: "Implement GetAllTrainPositions handler in apps/api/handlers/trains.go"
```

---

## Implementation Strategy

### MVP First (Phase A + Phase B Only)

**Goal**: Working map with real train data in ~1-2 days

1. ✅ Complete Phase 1: Setup (T001-T004)
2. ✅ Complete Phase 2: Backend API (T005-T023)
3. ✅ Complete Phase 3: 2D Markers (T024-T039)
4. **STOP and VALIDATE**: Test with real database
5. Deploy/demo if ready

**MVP Deliverables**:
- Working API serving real PostgreSQL data
- Map with orange dots at train positions
- Auto-updating every 30 seconds
- ~100 trains rendered smoothly

### Incremental Delivery (Phases A → B → C → D)

1. **Phase A** (T001-T023): API foundation
   - Test: `curl http://localhost:8080/api/trains`
   - Deploy backend independently

2. **Phase B** (T024-T039): 2D visualization
   - Test: Load map, see markers
   - **MVP CHECKPOINT** ✅

3. **Phase C** (T040-T052): 3D upgrade
   - Test: 3D models with orientation
   - Enhanced visual experience

4. **Phase D**: Rich features
   - **US2** (T053-T070): Info panel → Deploy
   - **US3** (T071-T085): Stop details → Deploy
   - **US4** (T086-T093): Filtering → Deploy

5. **Polish** (T094-T108): Production-ready

### Parallel Team Strategy

With 3 developers after Phase 2 completes:

- **Dev A**: Focus on US1 enhancement (Phase C: 3D models)
- **Dev B**: Focus on US2 (Info panel)
- **Dev C**: Focus on US4 (Filtering)
- **Then**: Dev B implements US3 (builds on US2)

---

## Notes

- **[P] markers**: Tasks can run in parallel (different files)
- **[Story] labels**: Map tasks to user stories for traceability
- **Checkpoint validation**: Test each phase independently before proceeding
- **MVP is Phase B**: Don't over-engineer - prove data flow works first
- **3D is enhancement**: Phase C can be deferred if timeline tight
- **Rich features last**: US2-US4 build on solid foundation

---

## Task Summary

**Total Tasks**: 109
**MVP Tasks** (Phase A + B): 40 (Setup through US1 2D)
**By Phase**:
- Phase 1 (Setup): 4 tasks
- Phase 2 (Backend API with TDD): 20 tasks (includes test-first approach)
- Phase 3 (US1 2D): 16 tasks
- Phase 4 (US1 3D): 13 tasks
- Phase 5 (US2 Panel): 18 tasks
- Phase 6 (US3 Stops): 15 tasks
- Phase 7 (US4 Filter): 8 tasks
- Phase 8 (Polish): 15 tasks

**Parallel Opportunities**: 41 tasks marked [P]
**Critical Path Length**: ~29 sequential tasks (Setup → API with TDD → 2D → 3D → Panel → Stops)
**Estimated MVP Time**: 1-2 days (experienced developer, working database)
**Estimated Full Feature**: 5-7 days (all user stories + polish)
