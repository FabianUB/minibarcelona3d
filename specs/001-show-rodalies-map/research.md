# Research: Rodalies Lines Map View

## State Management for Map UI Controls
- **Decision**: Manage selected line and accessibility toggle with a React context + `useReducer`.
- **Rationale**: Keeps state colocated with map components, avoids new dependencies, and supports predictable updates needed by Mapbox GL JS event handlers.
- **Alternatives considered**: Zustand store (adds dependency for a small surface); local component state (would fragment state across nested components).

## Location & Packaging of Rodalies GeoJSON
- **Decision**: Store vetted `LineGeometry.geojson`, per-line fragments, and station collection under `apps/web/public/rodalies_data/`.
- **Rationale**: Vite serves `public` assets without bundling overhead, enabling cache headers while keeping files versioned with the frontend.
- **Alternatives considered**: Importing GeoJSON via `src` (increases bundle size); fetching from runtime API (adds latency and external coupling).

## ShadCN Overlay Structure for Map-First Layout
- **Decision**: Use ShadCN `Sheet` on ≤768 px viewports and `Card` + `Command` list on wider screens, both positioned over the Mapbox GL JS canvas with non-blocking layout.
- **Rationale**: Satisfies constitution by keeping map visible while providing keyboard-accessible overlays that scale between mobile and desktop.
- **Alternatives considered**: Custom CSS panels (lacks standardized accessibility); modal dialogs (occludes the map against Principle I).

## Test-First Coverage Plan
- **Decision**: Author failing Playwright spec (`map-default-view.spec.ts`) for viewport + high-contrast toggle, and Vitest suite (`legend-store.test.tsx`) for legend filtering before implementation.
- **Rationale**: Aligns with Principle III by demonstrating failing UI integration and state tests that will later pass once the map and controls ship.
- **Alternatives considered**: Rely solely on Storybook/manual QA (not automated); delay Playwright coverage (risks regressions in responsive behavior).

## Bundle Size Monitoring Approach
- **Decision**: Add `rollup-plugin-visualizer` report in CI and enforce bundle delta via `pnpm run analyze-bundle` + `bundlesize` threshold in PR workflow.
- **Rationale**: Provides automated visibility into Mapbox GL JS’s impact and guards against exceeding constitution’s 10% bundle budget.
- **Alternatives considered**: Manual bundle inspection (no enforcement); introducing Webpack Bundle Analyzer (less aligned with Vite ecosystem).
