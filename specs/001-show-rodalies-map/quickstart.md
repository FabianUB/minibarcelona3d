# Quickstart: Rodalies Lines Map View

## Prerequisites
- Node.js ≥ 20.11 with `pnpm`
- Go 1.25.3 (for regression smoke tests)
- Valid `MAPBOX_TOKEN` exported in environment or `.env`

## Setup
```bash
pnpm install --filter web...
```

Copy vetted GeoJSON assets into `apps/web/public/rodalies_data/` (see `research.md` for structure). A sample manifest + placeholders will be generated during implementation.

## Run the Frontend
```bash
cd apps/web
pnpm dev
```
Visit `http://localhost:5173` and confirm:
- Map fills the viewport and centers on the Rodalies network (manifest default: lat `41.527316`, lng `1.806473`, zoom `8.2`)
- Recenter control (top-right) returns the map to the default manifest viewport after any pan/zoom
- Legend drawer renders via ShadCN `Sheet` (mobile) / `Card` (desktop)
- High-contrast toggle swaps line styling
- Legend-based line identification completes within 10 s; record observations with Playwright evidence.

## Test-Driven Development Flow
1. Add failing tests first:
   ```bash
   pnpm test --filter "legend-store"
   pnpm playwright test map-default-view.spec.ts
   ```
2. Implement map, legend, and accessibility features.
3. Re-run tests until they pass; capture initial failures in commit/PR notes.

To exercise the default viewport journey with the dev server, run:
```bash
PLAYWRIGHT_WEB_SERVER_CMD="pnpm dev -- --host=127.0.0.1 --port=5173" pnpm playwright test map-default-view.spec.ts
```

## Bundle & Accessibility Checks
```bash
pnpm run build
pnpm run analyze-bundle    # bundlesize threshold + rollup visualizer
pnpm playwright test --project=chromium --grep @axe  # axe assertions
```

## Regression Smoke Tests
Ensure backend remains healthy even without direct changes:
```bash
cd ../../apps/api
go test ./...
```

## Deployment Notes
- Ship updated static assets with the web artifact; CDN caching should respect `manifest.json` etag.
- Record bundle-size delta and attach Playwright report to the PR per constitution requirements.
