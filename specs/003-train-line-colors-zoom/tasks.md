# Tasks: Enhanced Train Spatial Separation and Zoom-Responsive Sizing

**Input**: Design documents from `/specs/003-train-line-colors-zoom/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Context**: Railway lines on the map already have colors. This feature enhances train visualization through spatial separation at high zoom and consistent screen-space sizing.

**Tests**: Unit tests and E2E tests are included as part of the implementation workflow per existing project patterns (Vitest + Playwright).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Project structure**: Monorepo with `apps/web/` (React frontend)
- **Implementation**: `apps/web/src/lib/trains/` for utilities
- **Tests**: `apps/web/tests/unit/` for unit tests, `apps/web/e2e/` for E2E tests
- **Types**: `apps/web/src/types/` and `specs/003-train-line-colors-zoom/contracts/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Ensure branch and type definitions are ready

- [x] T001 Verify feature branch 003-train-line-colors-zoom exists and is checked out
- [x] T002 [P] Review contracts/train-color-config.ts for type definitions reference
- [x] T003 [P] Review data-model.md for TrainMeshData extensions needed

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 Extend TrainMeshData interface in apps/web/src/lib/trains/trainMeshManager.ts with screenSpaceScale, lastZoomBucket fields
- [x] T005 Add LateralOffsetConfig interface to apps/web/src/lib/trains/trainMeshManager.ts based on contracts/train-color-config.ts
- [x] T006 Modify TrainMeshManager constructor in apps/web/src/lib/trains/trainMeshManager.ts to accept zoom parameter for offset computation
- [x] T007 Add currentZoom state tracking to TrainMeshManager in apps/web/src/lib/trains/trainMeshManager.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Spatial Separation at High Zoom (Priority: P1) 🎯 MVP

**Goal**: When multiple trains from different lines are at the same location (e.g., busy station), users see them separated side-by-side when zooming in (zoom > 14)

**Independent Test**:
1. Find station with 3+ trains (e.g., Barcelona-Sants)
2. Zoom to level 10 → trains closely positioned
3. Zoom to level 16 → trains spread out with 2-3 meters visible gap
4. Verify smooth transition when zooming between levels

### Implementation for User Story 1

- [x] T008 [P] [US1] Create computeLateralOffset() method in apps/web/src/lib/trains/trainMeshManager.ts with zoom-responsive multiplier
- [x] T009 [US1] Modify updateTrainMeshes() in apps/web/src/lib/trains/trainMeshManager.ts to call computeLateralOffset() with current zoom
- [x] T010 [US1] Update position calculation in apps/web/src/lib/trains/trainMeshManager.ts to apply enhanced offset perpendicular to bearing
- [x] T011 [US1] Pass current zoom from TrainLayer3D.customLayer.render() to TrainMeshManager in apps/web/src/features/trains/TrainLayer3D.tsx
- [x] T012 [P] [US1] Add unit tests for computeLateralOffset() in apps/web/tests/unit/trainMeshManager.test.ts verifying 40m→60m at zoom>14
- [ ] T012a [US1] **BLOCKED: Lateral offset implementation temporarily disabled** - Need to first implement US2 (zoom-responsive sizing) to understand actual train scale at different zoom levels, then calculate appropriate offset values that work across all zoom levels
- [ ] T013 [US1] Manual visual test per quickstart.md Scenario 1: verify spatial separation at Barcelona-Sants

**Checkpoint**: MODIFIED - US1 implementation paused. Lateral offset feature requires US2 (zoom-responsive sizing) to be completed first to determine proper offset calibration. The offset calculation infrastructure is in place but disabled until train scale behavior is understood.

---

## Phase 4: User Story 2 - Zoom-Responsive Train Sizing (Priority: P1)

**Goal**: Trains maintain appropriate visual size across all zoom levels (12-40px screen-space height) to prevent becoming too large at high zoom or too small at low zoom

**Independent Test**:
1. Zoom from level 5 to 17
2. Measure train screen-space height using DevTools
3. Verify trains stay within 12-40px range at all zoom levels
4. Verify smooth size transitions without jarring jumps

### Implementation for User Story 2

- [ ] T014 [P] [US2] Create ScaleManager class in apps/web/src/lib/trains/scaleManager.ts implementing IScaleManager interface
- [ ] T015 [P] [US2] Implement computeScale() method in apps/web/src/lib/trains/scaleManager.ts with exponential zoom compensation
- [ ] T016 [P] [US2] Implement zoom bucket quantization in apps/web/src/lib/trains/scaleManager.ts for caching (0.1 increments)
- [ ] T017 [P] [US2] Implement scale cache Map in apps/web/src/lib/trains/scaleManager.ts with getCacheStats() method
- [ ] T018 [US2] Add ScaleManager instance to TrainMeshManager constructor in apps/web/src/lib/trains/trainMeshManager.ts
- [ ] T019 [US2] Modify TrainLayer3D.customLayer.render() in apps/web/src/features/trains/TrainLayer3D.tsx to compute scale and apply to meshes
- [ ] T020 [US2] Update mesh.scale application in apps/web/src/features/trains/TrainLayer3D.tsx combining baseScale * randomVariation * zoomMultiplier
- [ ] T021 [P] [US2] Add unit tests for ScaleManager in apps/web/tests/unit/scaleManager.test.ts verifying scale computation and caching
- [ ] T022 [US2] Manual visual test per quickstart.md Scenario 2: verify 12-40px range across zoom 5-17

**Checkpoint**: At this point, trains should maintain consistent screen-space size across all zoom levels

---

## Phase 5: User Story 3 - Line Identification on Hover (Priority: P2)

**Goal**: When hovering over a train, users see a colored outline showing which railway line the train belongs to (using line brand colors)

**Independent Test**:
1. Hover over R1 train → light blue outline appears
2. Hover over R2 train → green outline appears
3. Move cursor away → outline disappears
4. Hover over unmapped route train → gray outline appears

### Implementation for User Story 3

- [ ] T023 [P] [US3] Create buildLineColorMap() helper in apps/web/src/lib/trains/outlineManager.ts based on contracts/train-color-config.ts
- [ ] T024 [P] [US3] Create createOutlineMesh() function in apps/web/src/lib/trains/outlineManager.ts using duplicate geometry with BackSide material
- [ ] T025 [P] [US3] Extend TrainMeshData in apps/web/src/lib/trains/trainMeshManager.ts with outlineMesh, lineCode, lineColor optional fields
- [ ] T026 [US3] Load RodaliesLine data in apps/web/src/features/trains/TrainLayer3D.tsx using existing dataLoader
- [ ] T027 [US3] Build line color map in apps/web/src/features/trains/TrainLayer3D.tsx on component mount
- [ ] T028 [US3] Modify handlePointerMove() in apps/web/src/features/trains/TrainLayer3D.tsx to detect hover state changes
- [ ] T029 [US3] Implement lazy outline creation in apps/web/src/features/trains/TrainLayer3D.tsx on first hover per train
- [ ] T030 [US3] Implement outline visibility toggle in apps/web/src/features/trains/TrainLayer3D.tsx on hover enter/leave
- [ ] T031 [P] [US3] Add unit tests for buildLineColorMap() in apps/web/tests/unit/outlineManager.test.ts
- [ ] T032 [US3] Manual visual test per quickstart.md Scenario 3: verify outline colors for R1, R2, R3, unmapped routes

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Integration & Testing

**Purpose**: End-to-end validation and performance verification

- [ ] T033 [P] Create E2E test in apps/web/e2e/train-spatial-zoom.spec.ts for spatial separation verification
- [ ] T034 [P] Create E2E test in apps/web/e2e/train-spatial-zoom.spec.ts for zoom-responsive sizing verification
- [ ] T035 [P] Create E2E test in apps/web/e2e/train-spatial-zoom.spec.ts for hover outline color verification
- [ ] T036 Add performance test in apps/web/e2e/train-spatial-zoom.spec.ts verifying 30+ FPS with 100 trains
- [ ] T037 Run full test suite with npm test and npm run test:e2e per quickstart.md
- [ ] T038 Performance profiling per quickstart.md: verify scale computation <0.1ms, total overhead <0.2ms per frame

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, cleanup, and optimization

- [ ] T039 [P] Add JSDoc comments to ScaleManager class in apps/web/src/lib/trains/scaleManager.ts
- [ ] T040 [P] Add JSDoc comments to computeLateralOffset() in apps/web/src/lib/trains/trainMeshManager.ts
- [ ] T041 [P] Add JSDoc comments to outline functions in apps/web/src/lib/trains/outlineManager.ts
- [ ] T042 Verify all TypeScript errors resolved with npm run build
- [ ] T043 Verify all ESLint errors resolved with npm run lint
- [ ] T044 Run quickstart.md testing checklist verification (all scenarios)
- [ ] T045 Update CLAUDE.md if new patterns or technologies introduced
- [ ] T046 Performance optimization: review cache hit rates, optimize if needed

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-5)**: All depend on Foundational phase completion
  - User stories can proceed in parallel (if staffed)
  - Or sequentially in priority order: US1 → US2 → US3
- **Integration (Phase 6)**: Depends on desired user stories being complete
- **Polish (Phase 7)**: Depends on all implementation being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 3 (P2)**: Can start after Foundational (Phase 2) - No dependencies on other stories (outline is independent feature)

**NOTE**: ⚠️ **DEPENDENCY CHANGE** - US2 must now be completed before US1 can be finalized. US1 lateral offset infrastructure is implemented but disabled pending US2 scale calibration. US3 can be deferred.

### Within Each User Story

- US1: ⚠️ **MODIFIED DEPENDENCY** - US1 implementation paused at T012a. Must complete US2 first to calibrate lateral offsets properly. Original flow: computeLateralOffset() → updateTrainMeshes() → pass zoom from render loop → tests → **[NEW]** → calibrate offsets based on US2 scale behavior → re-enable applyLateralOffset()
- US2: ScaleManager creation → integration with render loop → mesh scale application → tests
- US3: Color map → outline creation → hover detection → visibility toggle → tests

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- T004-T007 in Foundational can run sequentially (all modify TrainMeshManager)
- T008, T012 in US1 can run in parallel with US2 tasks (different files)
- T014-T017 in US2 can run in parallel (all within scaleManager.ts)
- T023-T025 in US3 can run in parallel (different files)
- T033-T036 in Integration can run in parallel (different test scenarios)
- T039-T041 in Polish can run in parallel (different files)

---

## Parallel Example: User Story 1

```bash
# Launch model extension and test creation together:
Task: "Create computeLateralOffset() method in apps/web/src/lib/trains/trainMeshManager.ts"
Task: "Add unit tests for computeLateralOffset() in apps/web/tests/unit/trainMeshManager.test.ts"
```

## Parallel Example: User Story 2

```bash
# Launch all ScaleManager methods together (same file, but independent methods):
Task: "Implement computeScale() method in apps/web/src/lib/trains/scaleManager.ts"
Task: "Implement zoom bucket quantization in apps/web/src/lib/trains/scaleManager.ts"
Task: "Implement scale cache Map in apps/web/src/lib/trains/scaleManager.ts"
```

## Parallel Example: User Story 3

```bash
# Launch color map and outline creation together:
Task: "Create buildLineColorMap() helper in apps/web/src/lib/trains/outlineManager.ts"
Task: "Create createOutlineMesh() function in apps/web/src/lib/trains/outlineManager.ts"
Task: "Extend TrainMeshData in apps/web/src/lib/trains/trainMeshManager.ts with outline fields"
```

---

## Implementation Strategy

### MVP First (User Stories 1 + 2 - Both P1)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (Spatial Separation)
4. Complete Phase 4: User Story 2 (Zoom-Responsive Sizing)
5. **STOP and VALIDATE**: Test US1 + US2 together independently
6. Run E2E tests for spatial separation + sizing
7. Deploy/demo if ready (MVP complete with P1 features)

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Spatial separation working
3. Add User Story 2 → Test independently → Sizing + separation working (MVP!)
4. Add User Story 3 → Test independently → Deploy/Demo (full feature)
5. Each story adds value without breaking previous stories

### Parallel Team Strategy

With 2-3 developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (Spatial Separation)
   - Developer B: User Story 2 (Zoom-Responsive Sizing)
   - Developer C: User Story 3 (Hover Outline)
3. Stories complete and integrate independently
4. US1 + US2 deploy as MVP, US3 follows as enhancement

---

## Performance Targets

Per research.md and quickstart.md:

- **Scale computation**: <0.1ms per frame (100 trains, cached)
- **Lateral offset enhancement**: <0.01ms per train update (not per frame)
- **Outline visibility toggle**: <0.01ms per hover event
- **Total overhead**: <0.2ms per frame
- **FPS target**: 30+ FPS with 100 trains
- **Cache hit rate**: >99% for zoom bucket cache

---

## Testing Strategy

### Unit Tests (Vitest)

- ScaleManager: Test scale computation, caching, clamp ranges (12-40px)
- TrainMeshManager: Test lateral offset computation (1.6m → 2.4m at zoom >14)
- OutlineManager: Test color map building, outline creation

### E2E Tests (Playwright)

- Spatial separation: Measure train positions at zoom 10 vs 16
- Zoom-responsive sizing: Measure train height at zoom 5, 10, 17
- Hover outline: Verify outline color matches line brand color
- Performance: Monitor FPS with 100 trains across zoom levels

### Manual Tests (per quickstart.md)

- Scenario 1: Co-located trains at Barcelona-Sants (spatial separation)
- Scenario 2: Zoom from 5 to 17 measuring screen-space height
- Scenario 3: Hover over R1, R2, R3 trains verifying outline colors

---

## Notes

- [P] tasks = different files or independent methods, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- US1 + US2 together form the MVP (both P1)
- US3 is optional enhancement (P2)
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Performance profiling is critical - verify <0.2ms overhead target
