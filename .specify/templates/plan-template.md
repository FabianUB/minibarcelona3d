# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]
**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

**Language/Version**: Go 1.25.3 (backend), TypeScript 5.x + React 18 (frontend)  
**Primary Dependencies**: chi v5, go-chi/cors, Mapbox GL JS, ShadCN UI, React Query (or agreed data-fetching layer)  
**Storage**: PostgreSQL projections defined in `docs/DATABASE_SCHEMA.md`  
**Testing**: `go test ./...`, `golangci-lint`, Vitest + Testing Library, Playwright (responsive + accessibility journeys)  
**Target Platform**: Containerized web stack (Docker Compose); browsers: latest Chrome, Firefox, Safari, mobile Safari/Chrome  
**Project Type**: Full-stack web (Go API + React SPA)  
**Performance Goals**: Map updates delivered within two backend poll intervals; API responses <300 ms p95 under expected load  
**Constraints**: Map-first responsive overlay (≥320 px width), TDD before implementation, CI-enforced bundle budget  
**Scale/Scope**: Catalonia Rodalies coverage; supports concurrent map sessions for riders and operations teams

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- Document how the map overlay remains visible, accessible, and ShadCN-based across breakpoints (Principle I).
- Describe how real-time train states and timestamps flow from backend pollers to UI surfaces, including stale-data handling (Principle II).
- List the failing backend and frontend tests that will be authored first, and how their initial failure will be captured (Principle III).
- Confirm backend work stays on Go 1.25.3 with chi, typed JSON contracts, and health/metrics endpoints (Principle IV).
- Plan for bundle-size monitoring, accessibility automation, and cross-browser verification (Principle V).

## Project Structure

### Documentation (this feature)

```
specs/[###-feature]/
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
├── api/      # Go 1.25.3 backend (chi router, structured logging, health endpoints)
└── web/      # React 18 + Vite frontend (Mapbox overlays, ShadCN components)

docker-compose.yml       # Canonical local environment
docs/                    # Domain knowledge (e.g., real-time schema)
```

**Structure Decision**: Document which of `apps/api`, `apps/web`, shared assets, and docs your plan touches and why.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
