# Implementation Plan: Real-Time Train Tracking with 3D Visualization

**Branch**: `002-realtime-train-tracking` | **Date**: 2025-10-24 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-realtime-train-tracking/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Build a real-time train tracking system that displays train positions on the map, updating dynamically as trains move. **Implementation is phased**: First build and test the Go API backend serving train data from PostgreSQL. Then implement simple 2D train visualization to prove the data flow works. Finally upgrade to 3D models and rich interaction features (info panels, stop details, filtering). This approach de-risks the integration and allows incremental delivery of value.

## Technical Context

**Language/Version**:
- Backend: Go 1.25.3
- Frontend: TypeScript 5 + React 19

**Primary Dependencies**:
- Backend: chi router (existing), pgx/v5 PostgreSQL driver (decided in research.md - ~20-30% faster than lib/pq)
- Frontend: Three.js, Mapbox GL JS 3.15.0 (existing), Vite, Vitest, Playwright

**Storage**: PostgreSQL database with `rt_rodalies_vehicle_current` table (documented in `/docs/DATABASE_SCHEMA.md`)

**Testing**:
- Backend: Go testing package (`go test`)
- Frontend: Vitest (unit/component), Playwright (E2E), @axe (accessibility)

**Target Platform**:
- Backend: Linux server/Docker container
- Frontend: Modern browsers (Chromium, Firefox, WebKit per Playwright config)

**Project Type**: Web application (frontend + backend monorepo)

**Performance Goals**:
- API response time <100ms for train position queries
- Frontend render 100+ concurrent train models at 60fps
- Train position updates every 10-30 seconds
- UI interaction response <500ms (per SC-002)

**Constraints**:
- Train models must render on top of line geometry (z-index layering)
- Support 95% of active trains simultaneously (SC-003)
- Smooth interpolation between position updates
- Graceful degradation when API unavailable

**Scale/Scope**:
- ~100 concurrent active trains (SC-006)
- Phased delivery: API first → 2D visualization → 3D upgrade → rich features
- Integration with existing feature 001 (map, lines, stations, legend)

**Implementation Phases**:
- **Phase A (MVP)**: Go API endpoints + PostgreSQL integration + basic tests
- **Phase B (Proof of concept)**: 2D train markers on map with real-time updates
- **Phase C (Enhancement)**: Upgrade to 3D models using Three.js
- **Phase D (Rich features)**: Train info panel, stop details, line filtering

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Status**: Constitution file is template-only (not yet project-specific). Proceeding with standard best practices:

- ✅ **Testing**: TDD approach - tests written and approved before implementation
- ✅ **Separation**: Clear API contracts between frontend/backend
- ✅ **Simplicity**: Start with core P1 functionality, iterate to P2-P4
- ✅ **Observability**: Structured logging in API, error boundaries in frontend

**Re-evaluation required after Phase 1 design** to verify data model and contracts align with best practices.

## Project Structure

### Documentation (this feature)

```text
specs/002-realtime-train-tracking/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   └── api.yaml         # OpenAPI spec for train endpoints
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
apps/
├── api/                 # Go backend (existing scaffold)
│   ├── main.go          # HTTP server entry point (existing)
│   ├── go.mod           # Dependencies (existing)
│   ├── handlers/        # NEW: HTTP request handlers
│   │   └── trains.go    # Train position/detail endpoints
│   ├── models/          # NEW: Domain models
│   │   └── train.go     # Train, Trip, StopTime structs
│   ├── repository/      # NEW: Data access layer
│   │   └── postgres.go  # PostgreSQL queries
│   └── tests/           # NEW: Go tests
│       ├── integration/ # API contract tests
│       └── unit/        # Handler/model unit tests
│
└── web/                 # React frontend (existing)
    ├── src/
    │   ├── features/
    │   │   ├── map/     # Existing map feature
    │   │   └── trains/  # NEW: Train tracking feature
    │   │       ├── TrainLayer.tsx       # Three.js train rendering
    │   │       ├── TrainInfoPanel.tsx   # Train detail panel
    │   │       ├── useTrainPositions.ts # Real-time data hook
    │   │       └── __tests__/           # Unit tests
    │   ├── lib/
    │   │   └── api/     # NEW: API client
    │   │       └── trains.ts            # Train API calls
    │   ├── types/
    │   │   └── trains.ts                # NEW: Train TypeScript types
    │   └── state/
    │       └── trains/  # NEW: Train state management
    │           └── TrainStateProvider.tsx
    └── e2e/
        └── train-tracking.spec.ts       # NEW: E2E tests for train features
```

**Structure Decision**: Monorepo structure with separate `apps/api` (Go backend) and `apps/web` (React frontend). Backend uses clean architecture with handlers → models → repository layers. Frontend follows existing pattern of feature-based organization with Context + Reducer state management (matching 001 implementation).

## Complexity Tracking

> **No constitution violations requiring justification.** Standard web app patterns apply.
