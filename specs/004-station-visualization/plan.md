# Implementation Plan: Station Visualization and Interaction

**Branch**: `004-station-visualization` | **Date**: 2025-11-14 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/004-station-visualization/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Enable users to view all Rodalies stations as interactive markers on the map. Users can click markers to view station details (name, code, serving lines) in a fixed detail panel, and hover to see quick tooltips on desktop. Station markers visually differentiate single-line vs multi-line stations and integrate with the existing line highlighting system. The feature uses radial offset positioning for overlapping markers and provides graceful error handling with retry capability.

## Technical Context

**Language/Version**: TypeScript 5.9.3, React 19.1.1
**Primary Dependencies**: Mapbox GL JS 3.4.0, Radix UI (dialogs, popovers), Tailwind CSS 4.1.16, Vitest 2.1.9, Playwright 1.48.2
**Storage**: Static GeoJSON files (Station.geojson), client-side caching via existing dataLoader
**Testing**: Vitest (unit/component tests), Playwright (E2E tests across Chromium/Firefox/WebKit)
**Target Platform**: Web browsers (desktop + mobile, minimum 320px viewport width)
**Project Type**: Web (React frontend in monorepo apps/web/)
**Performance Goals**: 30 FPS during map pan/zoom with 200+ stations, <500ms detail panel display, <100ms hover tooltip
**Constraints**: Must integrate with existing MapStateProvider context, use existing panel system pattern, render as Mapbox GL layers (not DOM elements)
**Scale/Scope**: 200+ station markers, 3 user stories (view, click, hover), integration with existing line highlighting system

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Status**: ✅ PASS - No project constitution defined; proceeding with best practices

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
apps/web/
├── src/
│   ├── features/
│   │   └── stations/                    # New: Station feature directory
│   │       ├── StationLayer.tsx          # Mapbox GL layer for station markers
│   │       ├── StationInfoPanel.tsx      # Fixed panel for station details
│   │       ├── StationInfoPanelMobile.tsx
│   │       ├── StationInfoPanelDesktop.tsx
│   │       └── hooks/
│   │           ├── useStationMarkers.ts  # Station marker rendering logic
│   │           └── useStationHover.ts    # Hover tooltip management
│   ├── state/
│   │   ├── map/
│   │   │   ├── MapStateProvider.tsx      # Updated: Add station selection state
│   │   │   └── types.ts                  # Updated: Add station-related actions
│   │   └── stations/                     # New: Station-specific state (if needed)
│   │       ├── stationStore.ts           # Zustand store for station selection
│   │       └── types.ts
│   ├── lib/
│   │   ├── rodalies/
│   │   │   └── dataLoader.ts             # Already has loadStations()
│   │   └── stations/
│   │       ├── markerPositioning.ts      # Radial offset calculation
│   │       └── markerStyles.ts           # Marker visual differentiation
│   └── types/
│       └── rodalies.ts                   # Already has Station types
├── public/
│   └── rodalies_data/
│       └── Station.geojson               # Existing station data
└── e2e/
    └── stations.spec.ts                  # New: E2E tests for station features
```

**Structure Decision**: Using existing monorepo web application structure (apps/web/). Station feature follows established pattern: features/stations/ for UI components, state/stations/ for state management (if needed beyond MapStateProvider), lib/stations/ for business logic utilities. Integrates with existing dataLoader, types, and map state infrastructure.

## Complexity Tracking

*No constitution violations - section not applicable*

---

## Phase Completion Summary

### ✅ Phase 0: Research (Complete)

**Output**: [research.md](./research.md)

**Key Decisions**:
- R1: Mapbox GL Layers for rendering (GPU-accelerated, 30+ FPS with 200+ stations)
- R2: Radial offset positioning algorithm (polar coordinates, deterministic)
- R3: Extend MapStateProvider (consistency with project patterns)
- R4: Radix UI Dialog for panel (accessibility, existing pattern)
- R5: Mapbox GL Popup for hover tooltips (lightweight, native integration)
- R6: Concentric circles for multi-line differentiation (clear visual distinction)
- R7: Exponential backoff retry with manual trigger (resilience + user control)
- R8: Three-tier testing strategy (unit/component/E2E)

### ✅ Phase 1: Design & Contracts (Complete)

**Outputs**:
- [data-model.md](./data-model.md) - State extensions, entity definitions, validation rules
- [contracts/component-interfaces.ts](./contracts/component-interfaces.ts) - TypeScript interface contracts
- [quickstart.md](./quickstart.md) - Implementation guide with code examples
- CLAUDE.md updated with new technologies (via update-agent-context.sh)

**Design Artifacts**:
- **State Model**: Extended MapUIState with `selectedStationId`, `stationLoadError`
- **Actions**: Added `selectStation()`, `retryStationLoad()` to MapActions
- **Components**: StationLayer, StationInfoPanel (desktop/mobile variants)
- **Utilities**: `calculateRadialOffsets()`, `getStationMarkerStyles()`
- **Hooks**: `useStationMarkers()`, `useStationHover()`

**Constitution Re-Check**: ✅ PASS (no violations, follows project best practices)

### 🔜 Phase 2: Task Generation (Next Step)

**Command**: `/speckit.tasks`

**Expected Output**: `tasks.md` with dependency-ordered implementation tasks

---

## Implementation Readiness

**Status**: ✅ Ready for task generation

**Prerequisites Met**:
- [x] Feature specification complete and clarified
- [x] Technical research complete
- [x] Data model designed
- [x] Component contracts defined
- [x] Implementation guide available
- [x] Agent context updated

**Risk Assessment**: **LOW**
- Well-understood technology stack (Mapbox GL, React, Radix UI)
- Clear integration points with existing codebase
- Comprehensive research addresses all technical unknowns
- Testing strategy covers all user stories

**Next Action**: Run `/speckit.tasks` to generate implementation task list
