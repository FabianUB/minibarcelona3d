<!--
Sync Impact Report
- Version change: 0.0.0 → 1.0.0
- Modified principles:
  - [PRINCIPLE_1_NAME] → I. Map-First Clarity
  - [PRINCIPLE_2_NAME] → II. Real-Time Trustworthiness
  - [PRINCIPLE_3_NAME] → III. TDD or It Doesn't Ship
  - [PRINCIPLE_4_NAME] → IV. Go API Stewardship
  - [PRINCIPLE_5_NAME] → V. Frontend Excellence & Accessibility
- Added sections: Core Principles definitions, Technology & Architecture Constraints, Development Workflow
- Removed sections: none
- Templates requiring updates:
  - ✅ .specify/templates/plan-template.md
  - ✅ .specify/templates/spec-template.md
  - ✅ .specify/templates/tasks-template.md
- Follow-up TODOs: none
-->

# Mini Rodalies 3D Constitution

## Core Principles

### I. Map-First Clarity
- MUST render a Mapbox GL map as the persistent base layer on every user-facing page; overlay panels never hide the map by default.
- MUST implement overlays with ShadCN components that support keyboard navigation, focus management, and WCAG AA contrast.
- MUST verify responsive behavior (≥320px width) with automated visual or DOM assertions before release.

Rationale: Riders visit to see trains in context; the map must always be front and center and usable on any device.

### II. Real-Time Trustworthiness
- MUST populate train markers from the Rodalies GTFS-RT feed (backed by the `rt_rodalies_*` tables) and refresh at least once per backend poll cycle.
- MUST expose train state (IN_TRANSIT_TO, STOPPED_AT, DELAYED, UNKNOWN) and last update timestamps in both API responses and UI surfaces.
- MUST surface a visible stale-data warning when no fresh snapshot arrives within two poll intervals and emit structured logs for investigation.

Rationale: Accurate state and transparency build user trust and support operational debugging.

### III. TDD or It Doesn't Ship
- MUST author automated tests that fail before implementing new behavior or fixes, and capture the failing evidence in commits or PR checks.
- MUST keep the Go suite (`go test ./...`) and the web suite (Vitest, Playwright, or equivalent) green before merging subsequent work.
- MUST add regression coverage whenever a bug is fixed or a new GTFS edge case is understood.

Rationale: TDD guards real-time correctness and prevents regressions as the feeds evolve.

### IV. Go API Stewardship
- MUST build backend services in Go 1.25.3 using chi routers, context-aware handlers, and dependency-injection-friendly seams for testing.
- MUST return typed JSON schemas with explicit HTTP status codes and structured error bodies; no panic propagates to the router.
- MUST expose health, readiness, and metrics endpoints and emit structured logs that include request IDs plus poll cycle identifiers.

Rationale: Idiomatic, observable Go services keep the data reliable and maintainable.

### V. Frontend Excellence & Accessibility
- MUST build the React app with Vite and TypeScript, composing ShadCN components and map-focused hooks for reuse.
- MUST track initial bundle size in CI and block merges if it grows by more than 10% without recorded approval.
- MUST enforce accessibility (axe) and cross-browser checks (latest Chrome, Firefox, Safari) in automated runs tied to PRs.

Rationale: A high-quality, inclusive UI ensures the map remains fast and usable for every rider.

## Technology & Architecture Constraints
- Backend code lives in `apps/api`, targets Go 1.25.3, and uses chi/cors; new packages reside under `internal/` or `pkg/` with clear boundaries.
- Frontend code lives in `apps/web`, uses React 18 + Vite + ShadCN, and keeps map integrations in dedicated modules (e.g., `src/map/`).
- Mapbox access tokens are provided via environment variables (`MAPBOX_TOKEN`) and never committed; Docker Compose files read from `.env`.
- API responses model the schema documented in `docs/DATABASE_SCHEMA.md`, including timestamps and status semantics.
- Docker Compose is the canonical way to run the stack locally; updates must keep `docker-compose.yml` working for both services.

## Development Workflow
- Work begins with `/speckit.plan` and `/speckit.spec` outputs that satisfy the Constitution Check items before coding starts.
- Feature branches follow `feature/<ticket>-<slug>`; hotfix branches use `hotfix/<slug>`.
- Tests for backend and frontend are written and committed before implementation commits; CI proves they failed once.
- Every PR description links to plan/spec/docs updates, includes screenshots or recordings for UI changes, and states test commands run.
- CI pipelines run `go test ./...`, `golangci-lint` (or equivalent), `pnpm lint`, `pnpm test`, accessibility checks, and bundle analysis before merge.

## Governance
- This constitution supersedes conflicting practices; any exception requires a tracked TODO and follow-up issue.
- Amendments require a PR referencing review notes, updated version numbers, refreshed templates, and a maintainer approval from backend and frontend leads.
- Versioning follows Semantic Versioning: MAJOR for principle overhauls/removals, MINOR for new principles or sections, PATCH for clarifications.
- Compliance reviews occur before each release milestone; unresolved violations block release until remediated or formally waived.

**Version**: 1.0.0 | **Ratified**: 2025-10-21 | **Last Amended**: 2025-10-21
