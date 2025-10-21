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
- Map centers on Rodalies network
- Legend drawer renders via ShadCN `Sheet` (mobile) / `Card` (desktop)
- High-contrast toggle swaps line styling
- Time a legend-based line identification (target ≤10 s) and record findings alongside Playwright evidence.

## Test-Driven Development Flow
1. Add failing tests first:
   ```bash
   pnpm test --filter "legend-store"
   pnpm playwright test map-default-view.spec.ts
   ```
2. Implement map, legend, and accessibility features.
3. Re-run tests until they pass; capture initial failures in commit/PR notes.

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
