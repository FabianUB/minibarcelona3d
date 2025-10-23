# Tasks: Rodalies Lines Map View

**Input**: Design documents from `/specs/001-show-rodalies-map/`  
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are MANDATORY. Write them first, record the failing evidence, and keep suites green per the constitution.  
**Organization**: Tasks are grouped by user story so each slice ships independently and preserves the map-first experience.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Runs in parallel (different files, no shared state)
- **[Story]**: User story label (US1, US2, US3)
- Mention whether the work touches `apps/web` and include exact file paths.

## Path Conventions
- Frontend React code lives in `apps/web/src`; tests use `*.test.tsx` (Vitest/Testing Library).
- End-to-end and accessibility tests live under `apps/web/e2e` (Playwright).
- Static assets reside in `apps/web/public/rodalies_data`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Ensure dependencies, environment, and tooling uphold the constitution.

- [X] T001 Update apps/web/package.json to add Mapbox GL JS, @types/mapbox-gl, Playwright, and rollup-plugin-visualizer entries.
- [X] T002 [P] Create apps/web/.env.example documenting required `MAPBOX_TOKEN` and data asset expectations.
- [X] T003 [P] Scaffold Playwright configuration with axe hooks in apps/web/playwright.config.ts.
- [X] T004 [P] Wire bundle analysis (`pnpm run analyze-bundle`) and accessibility scripts in apps/web/package.json.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST exist before user stories start.

**⚠️ CRITICAL**: No user story work may begin until this phase is complete.

- [X] T005 Define manifest, line, station, and UI types in apps/web/src/types/rodalies.ts.
- [X] T006 [P] Implement reusable data loader utilities for manifest/GeoJSON in apps/web/src/lib/rodalies/dataLoader.ts.
- [X] T007 Establish Map state provider with reducer actions in apps/web/src/state/map/MapStateProvider.tsx.
- [X] T008 [P] Build Mapbox canvas shell component and style imports in apps/web/src/features/map/MapCanvas.tsx.
- [X] T009 Initialize global Mapbox styles and CSS variables in apps/web/src/styles/map.css.

**Checkpoint**: Foundation ready — user stories can proceed in parallel.

---

## Phase 3: User Story 1 - View the full Rodalies network (Priority: P1) 🎯 MVP

**Goal**: Deliver a default Rodalies-centered map view with recenter control and bundled data.  
**Independent Test**: Launch on a clean profile and confirm the viewport shows all lines; recenter restores defaults.

### Tests for User Story 1 (write first)

- [X] T010 [P] [US1] Add failing Playwright journey covering default viewport + recenter in apps/web/e2e/map-default-view.spec.ts.
- [X] T011 [P] [US1] Author Vitest map state test ensuring reset behavior in apps/web/src/state/map/__tests__/mapViewport.test.ts.

### Implementation for User Story 1

- [X] T012 [P] [US1] Expose typed default viewport from manifest via apps/web/src/lib/rodalies/dataLoader.ts.
- [X] T013 [US1] Wire Mapbox map initialization and aggregated line layers in apps/web/src/features/map/MapCanvas.tsx.
- [X] T014 [US1] Implement default viewport hook and recenter control in apps/web/src/features/map/useDefaultViewport.ts.
- [X] T015 [US1] Mount map shell and controls in the main layout within apps/web/src/App.tsx.
- [X] T016 [US1] Update quickstart checks to document viewport verification in specs/001-show-rodalies-map/quickstart.md.

**Checkpoint**: User Story 1 is fully functional and testable independently.

---

## Phase 4: User Story 2 - Understand individual line outlines (Priority: P2)

**Goal**: Provide readable line outlines with an interactive legend for highlighting/isolation.  
**Independent Test**: Toggle each line and verify legend selection updates the map styling.

### Tests for User Story 2 (write first)

- [X] T017 [P] [US2] Add Vitest legend store tests validating highlight/isolate behavior in apps/web/src/features/legend/__tests__/legend-store.test.tsx.
- [X] T018 [P] [US2] Create Playwright scenario verifying legend toggles in apps/web/e2e/legend-highlight.spec.ts.
- [X] T019 [P] [US2] Automate legend identification timing in apps/web/e2e/legend-identification.spec.ts (assert selection completes ≤10 s for SC-002 evidence).

### Implementation for User Story 2

- [X] T020 [US2] Extend map state actions/selectors for highlighted lines in apps/web/src/state/map/MapStateProvider.tsx.
- [X] T021 [P] [US2] Build accessible legend UI with ShadCN components in apps/web/src/features/legend/LegendPanel.tsx.
- [X] T022 [US2] Implement Mapbox line layer styling + emphasis tokens in apps/web/src/features/map/layers/lineLayers.ts.
- [X] T023 [US2] Connect legend interactions to map highlight logic in apps/web/src/features/map/useLineHighlight.ts.
- [X] T024 [US2] Surface line-geometry load warnings in apps/web/src/features/map/MapCanvas.tsx and cover the alert path in apps/web/e2e/map-default-view.spec.ts.

**Checkpoint**: User Stories 1 and 2 both function independently.

---

## Phase 5: User Story 3 - Access the map on smaller screens (Priority: P3)

**Goal**: Ensure mobile usability with responsive legend, high-contrast toggle, and persistence.  
**Independent Test**: Load map at ≤375 px width and confirm readability, contrast toggle, and legend accessibility.

### Tests for User Story 3 (write first)

- [ ] T025 [P] [US3] Create Playwright mobile scenario asserting responsive legend + contrast in apps/web/e2e/mobile-accessibility.spec.ts.
- [ ] T026 [P] [US3] Add Vitest tests for contrast toggle state persistence in apps/web/src/features/accessibility/__tests__/contrast-toggle.test.tsx.

### Implementation for User Story 3

- [ ] T027 [US3] Implement high-contrast toggle component in apps/web/src/features/accessibility/ContrastToggle.tsx.
- [ ] T028 [P] [US3] Build mobile legend sheet experience in apps/web/src/features/legend/LegendSheet.tsx.
- [ ] T029 [US3] Persist contrast preference to localStorage in apps/web/src/state/map/persistence.ts.
- [ ] T030 [US3] Finalize responsive layout and contrast styles in apps/web/src/styles/map.css.

**Checkpoint**: All selected user stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Tasks that sharpen the experience across stories.

- [ ] T031 [P] Refresh documentation with bundle/a11y instructions in specs/001-show-rodalies-map/quickstart.md.
- [ ] T032 Verify bundle analysis + accessibility pipelines in apps/web/package.json and CI configuration.
- [ ] T033 [P] Run and document Playwright/Vitest regression evidence in apps/web/e2e/README.md.
- [ ] T034 Harden Mapbox token handling and error messaging in apps/web/src/lib/rodalies/dataLoader.ts.
- [ ] T035 [P] Inject tile-load failure banner and retry control in apps/web/src/features/map/MapCanvas.tsx with coverage in apps/web/e2e/map-default-view.spec.ts.
- [ ] T036 Record initial render timing + geometry load metrics via apps/web/src/lib/analytics/perf.ts and assert thresholds in apps/web/e2e/perf-budget.spec.ts.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion — blocks all user stories.
- **User Stories (Phase 3–5)**: All depend on Foundational completion. Deliver in priority order (P1 → P2 → P3) for MVP-first, though parallel development is possible once tests are in place.
- **Polish (Phase 6)**: Depends on completion of targeted user stories.

### User Story Dependencies

- **User Story 1 (P1)**: Starts after Foundational; provides base map view.
- **User Story 2 (P2)**: Starts after Foundational; consumes map state from US1 but maintains its own tests.
- **User Story 3 (P3)**: Starts after Foundational; builds on existing components while remaining independently testable.

### Within Each User Story

- Author failing tests first, then implement features until tests pass.
- Frontend workflow: data loader → state updates → UI components → styling/responsiveness.
- Capture bundle and accessibility impacts before closing tasks.

---

## Parallel Execution Examples

- **Example 1 (Post-Foundational)**:  
  - T010 (Playwright default view) and T011 (Vitest map state) can run parallel while T012 begins manifest wiring.
- **Example 2 (User Story 2)**:  
  - T017 (legend store test) and T018 (Playwright highlight) run parallel while T021 builds the legend UI.
- **Example 3 (User Story 3)**:  
  - T025 (mobile Playwright) and T026 (contrast persistence test) proceed simultaneously while T028 implements the legend sheet.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (Setup).  
2. Complete Phase 2 (Foundational).  
3. Execute Phase 3 (US1) — run tests, confirm failing → passing.  
4. Demo/ship the default map view as the MVP.

### Incremental Delivery

1. Foundation ready (Phases 1–2).  
2. Deliver US1 → validate tests → merge/deploy.  
3. Deliver US2 → validate tests → merge/deploy.  
4. Deliver US3 → validate tests → merge/deploy.  
5. Apply Phase 6 polish items before final release.

### Parallel Team Strategy

After Foundational completion:
- Developer A owns US1 tasks.  
- Developer B owns US2 tasks (legend).  
- Developer C owns US3 tasks (mobile + contrast).  
- Coordinate via [P] tasks to avoid file conflicts and ensure each story maintains independent tests.
