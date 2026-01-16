# Implementation Plan: Rodalies Lines Map View

**Branch**: `001-show-rodalies-map` | **Date**: 2025-10-21 | **Spec**: [`spec.md`](./spec.md)  
**Input**: Feature specification from `/specs/001-show-rodalies-map/spec.md`

## Summary

Deliver a Mapbox GL JS-powered web map that opens centered on the full Rodalies network, renders each line with accessible outlines, and lets riders recenter or highlight lines. We will bundle vetted GeoJSON geometry (lines + station points), source Mapbox vector tiles for the base, and expose a manual high-contrast toggle to satisfy accessibility requirements while keeping the experience performant on desktop and mobile.

## Technical Context

**Language/Version**: TypeScript 5.x + React 18 (frontend SPA); Go 1.25.3 backend remains available but no new backend components expected  
**Primary Dependencies**: Mapbox GL JS, Mapbox vector tiles (`mapbox://` styles), ShadCN UI components, rollup-plugin-visualizer (tooling)  
**Storage**: Bundled static GeoJSON assets under `apps/web/public/rodalies_data/` with shared manifest  
**Testing**: Vitest + Testing Library for components, Playwright for responsive/a11y journeys, `go test ./...` (smoke)  
**Target Platform**: Vite dev/build pipeline deployed via Docker Compose; browsers: latest Chrome, Firefox, Safari, mobile Safari/Chrome  
**Project Type**: Frontend-heavy feature within existing full-stack app  
**Performance Goals**: Initial map render ≤3 s on broadband; interactions remain ≥45 FPS on mainstream laptops/mobiles  
**Constraints**: Map-first responsive layout with ShadCN overlays; manual high-contrast toggle for colorblind users; Mapbox token via `VITE_MAPBOX_TOKEN` env  
**Scale/Scope**: Covers all Rodalies Catalonia lines; supports simultaneous sessions without backend federation

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- Principle I (Map-First Clarity): Use ShadCN `Sheet` on mobile and `Card`+`Command` overlays on desktop while keeping the Mapbox GL JS canvas visible at ≥320 px with keyboard focus traps.
- Principle II (Real-Time Trustworthiness): Static line overlays do not alter GTFS-RT polling; ensure existing train-refresh flow remains untouched, surface geometry/tile load warnings in the UI, and emit structured logs for investigation.
- Principle III (TDD or It Doesn't Ship): Author failing `map-default-view.spec.ts` (Playwright) and `legend-store.test.tsx` (Vitest) before implementation to capture viewport, legend, and contrast behaviors.
- Principle IV (Go API Stewardship): No backend changes expected; run `go test ./...` + lint to confirm compatibility with existing APIs and ensure typed contracts untouched.
- Principle V (Frontend Excellence & Accessibility): Integrate `bundlesize` + `rollup-plugin-visualizer` in CI, add axe assertions to Playwright suite, and verify Chrome/Firefox/Safari coverage.

**Gate Status**: PASS — design artifacts above document concrete steps satisfying each principle; no exceptions requested.

## Project Structure

### Documentation (this feature)

```
specs/001-show-rodalies-map/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```
apps/
├── api/      # Go 1.25.3 backend (chi router, structured logging, health endpoints) — no new changes expected
└── web/      # React 18 + Vite frontend (Mapbox GL JS overlays, ShadCN components)

public/rodalies_data     # Bundled GeoJSON + JSON assets (lines, stations, manifest)
docker-compose.yml       # Canonical local environment
docs/                    # Domain knowledge (e.g., real-time schema)
```

**Structure Decision**: Primary work happens in `apps/web` (map components, UI state) plus `public/` for GeoJSON assets. Documentation updates live under `specs/001-show-rodalies-map/`. No backend code changes anticipated, but regression checks in `apps/api` will run to satisfy constitution gates.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
