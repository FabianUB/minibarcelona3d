---
description: "Task list template for feature implementation"
---

# Tasks: [FEATURE NAME]

**Input**: Design documents from `/specs/[###-feature-name]/`  
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are MANDATORY. Write them first, record the failing evidence, and keep suites green per the constitution.  
**Organization**: Tasks are grouped by user story so each slice ships independently and preserves the map-first experience.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Runs in parallel (different files, no shared state)
- **[Story]**: User story label (US1, US2, …)
- Mention whether the work touches `apps/api` (Go) or `apps/web` (React) and include exact file paths.

## Path Conventions
- Backend Go code lives in `apps/api`; tests sit beside code (`*_test.go`).
- Frontend React code lives in `apps/web/src`; tests use `*.test.tsx` (Vitest/Testing Library).
- End-to-end and accessibility tests live under `apps/web/e2e` (Playwright).

<!--
  ============================================================================
  SAMPLE TASKS BELOW MUST BE REPLACED BY /speckit.tasks OUTPUT.
  Keep the structure but substitute real tasks derived from the spec/plan/data-model.
  ============================================================================
-->

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Ensure tooling, environment, and dependencies uphold the constitution.

- [ ] T001 Align plan/spec deliverables with Constitution Check gates.
- [ ] T002 Configure Go dependencies (`apps/api/go.mod`) and chi middleware scaffolding.
- [ ] T003 [P] Configure React Vite workspace with ShadCN baseline (`apps/web`).
- [ ] T004 [P] Wire lint/test commands (go test, golangci-lint, pnpm lint/test, bundle analysis, accessibility).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST exist before user stories start.

**⚠️ CRITICAL**: No user story work may begin until this phase is complete.

- [ ] T005 Implement Rodalies data service interfaces and repositories (`apps/api/internal/...`).
- [ ] T006 [P] Define shared domain models + typed responses (`apps/api/internal/models`).
- [ ] T007 Establish health/readiness/metrics endpoints and structured logging.
- [ ] T008 Build Mapbox wrapper, overlay shell, and responsive layout primitives (`apps/web/src/map`).
- [ ] T009 Configure environment handling for tokens/API URLs (respect `.env` and Docker Compose).

**Checkpoint**: Foundation ready — user stories can proceed in parallel.

---

## Phase 3: User Story 1 - [Title] (Priority: P1) 🎯 MVP

**Goal**: [Brief description of what this story delivers]

**Independent Test**: [How to verify this story works on its own]

### Tests for User Story 1 (MANDATORY — write first)

- [ ] T010 [P] [US1] Go handler/service test in `apps/api/<path>_test.go` covering API contract.
- [ ] T011 [P] [US1] Vitest/Testing Library test in `apps/web/src/<component>.test.tsx`.
- [ ] T012 [P] [US1] Playwright journey validating map overlay + accessibility in `apps/web/e2e/<journey>.spec.ts`.

### Implementation for User Story 1

- [ ] T013 [P] [US1] Implement domain service/controller (`apps/api/internal/<domain>`).
- [ ] T014 [US1] Expose chi handler + route wiring.
- [ ] T015 [US1] Integrate handler into router and update API documentation.
- [ ] T016 [US1] Implement React overlay components in `apps/web/src/components/<name>`.
- [ ] T017 [US1] Wire data fetching (React Query or equivalent) and map markers.
- [ ] T018 [US1] Add structured logging and stale-data warning UI.
- [ ] T019 [US1] Update supporting docs (`docs/` or spec addendum).

**Checkpoint**: User Story 1 is fully functional and testable independently.

---

## Phase 4: User Story 2 - [Title] (Priority: P2)

**Goal**: [Brief description of what this story delivers]

**Independent Test**: [How to verify this story works on its own]

### Tests for User Story 2 (MANDATORY — write first)

- [ ] T020 [P] [US2] Go contract/integration test covering new API surface.
- [ ] T021 [P] [US2] Vitest component/hook test.
- [ ] T022 [P] [US2] Playwright scenario verifying responsive behavior and stale-data messaging.

### Implementation for User Story 2

- [ ] T023 [P] [US2] Extend domain models/services in `apps/api/internal/<domain>`.
- [ ] T024 [US2] Add or update chi routes/controller glue.
- [ ] T025 [US2] Implement React UI flows in `apps/web/src/...`.
- [ ] T026 [US2] Integrate with User Story 1 components while preserving independence.

**Checkpoint**: User Stories 1 and 2 both function independently.

---

## Phase 5: User Story 3 - [Title] (Priority: P3)

**Goal**: [Brief description of what this story delivers]

**Independent Test**: [How to verify this story works on its own]

### Tests for User Story 3 (MANDATORY — write first)

- [ ] T027 [P] [US3] Go contract/integration test.
- [ ] T028 [P] [US3] Vitest test for UI logic/state.
- [ ] T029 [P] [US3] Playwright accessibility/regression test.

### Implementation for User Story 3

- [ ] T030 [P] [US3] Extend backend domain/service code.
- [ ] T031 [US3] Update chi handlers/routes.
- [ ] T032 [US3] Implement React UI & overlays.
- [ ] T033 [US3] Update stale-data or alerting UX as required.

**Checkpoint**: All selected user stories are independently functional.

---

[Add more user story phases as needed, following the same pattern]

---

## Phase N: Polish & Cross-Cutting Concerns

**Purpose**: Tasks that sharpen the experience across stories.

- [ ] TXXX [P] Documentation updates in `docs/` and `/specs/`.
- [ ] TXXX Code cleanup/refactoring with new regression tests.
- [ ] TXXX Performance optimization (API latency, bundle size, map render).
- [ ] TXXX [P] Additional regression tests (Go + Vitest + Playwright).
- [ ] TXXX Security hardening (Mapbox token handling, headers).
- [ ] TXXX Run quickstart.md validation / Docker Compose smoke tests.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion — blocks all user stories.
- **User Stories (Phase 3+)**: All depend on Foundational completion.
  - User stories can proceed in parallel (team permitting) once their failing tests exist.
  - Sequential delivery follows priority order (P1 → P2 → P3).
- **Polish (Final Phase)**: Depends on all desired user stories completing.

### User Story Dependencies

- **User Story 1 (P1)**: Starts after Foundational, no other story dependency.
- **User Story 2 (P2)**: Starts after Foundational, may consume US1 contracts but must remain independently testable.
- **User Story 3 (P3)**: Starts after Foundational, may integrate with US1/US2 while keeping its own tests.

### Within Each User Story

- Tests MUST be written first, fail first, and pass before implementation tasks close.
- Backend: models/interfaces → services → handlers/routes.
- Frontend: data layer → components → overlays/responsiveness → polish.
- Log and document stale-data handling and bundle impact as part of the story.

### Parallel Opportunities

- Setup and Foundational tasks marked [P] can run concurrently.
- After Foundational, stories may proceed in parallel if their touchpoints do not collide.
- Within a story, [P] tasks span different files/modules (e.g., backend vs frontend) and can proceed simultaneously.

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task: "Go handler test in apps/api/<path>_test.go"
Task: "Vitest map overlay test in apps/web/src/<component>.test.tsx"
Task: "Playwright accessibility scenario in apps/web/e2e/<journey>.spec.ts"

# Launch supporting implementation tasks in parallel:
Task: "Implement domain model in apps/api/internal/<domain>"
Task: "Implement React overlay component in apps/web/src/components/<name>"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories).
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: Run all tests, demonstrate failing → passing history.
5. Deploy/demo if ready.

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready.
2. Add User Story 1 → Test independently → Deploy/Demo (MVP).
3. Add User Story 2 → Test independently → Deploy/Demo.
4. Add User Story 3 → Test independently → Deploy/Demo.
5. Each story adds value without breaking previous stories.

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together.
2. Once Foundational is done:
   - Developer A: User Story 1.
   - Developer B: User Story 2.
   - Developer C: User Story 3.
3. Stories complete independently; merge only after all tests pass.

---

## Notes

- [P] tasks = different files, no dependencies.
- [Story] labels map tasks to user stories for traceability.
- Every task must cite test evidence before merge.
- Commit after each task or logical group to document TDD progression.
- Halt at checkpoints if tests fail or bundle/accessibility budgets regress.
- Avoid vague tasks, cross-story coupling, or work that obscures the map.
