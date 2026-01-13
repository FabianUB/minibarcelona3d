# Quickstart: Rodalies Lines Map View

## Prerequisites
- Node.js ≥ 20.11 with `pnpm`
- Go 1.25.3 (for regression smoke tests)
- Valid `VITE_MAPBOX_TOKEN` exported in environment or `.env`

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

### Bundle Analysis
Build and analyze the production bundle to ensure optimal performance:
```bash
cd apps/web
pnpm run build                    # Create optimized production build
pnpm run analyze-bundle           # Generate bundle visualization and stats
```

**Expected Outcomes**:
- Bundle size should be under 500KB gzipped (excluding Mapbox GL JS)
- Check `dist/stats.html` for bundle composition
- Largest chunks should be: vendor (React, Mapbox), app code, styles
- Look for unexpected duplications or large dependencies

**Bundle Size Monitoring**:
- Record bundle size in PR descriptions
- Compare against previous builds
- Flag any increases >10% for review

### Accessibility Testing
Run automated accessibility checks with axe-core:
```bash
cd apps/web
pnpm test:accessibility           # Run axe checks on all pages
```

**Coverage Areas**:
- Color contrast ratios (WCAG AA minimum 4.5:1 for text)
- Keyboard navigation (all interactive elements reachable)
- ARIA labels and roles (screen reader compatibility)
- Touch target sizes (≥44x44px for mobile)
- Focus indicators (visible on all interactive elements)

**Manual Accessibility Verification**:
1. **Keyboard Navigation**: Tab through all controls (legend, settings, map controls)
2. **Screen Reader**: Test with VoiceOver (macOS) or NVDA (Windows)
3. **High Contrast Mode**: Toggle "Enhance Line Visibility" and verify line thickness increases
4. **Mobile Touch Targets**: Verify all buttons/toggles are easily tappable (≥44x44px)
5. **Color Blindness**: Test legend colors with color blindness simulators

**Expected Results**:
- Zero critical axe violations
- All interactive elements keyboard-accessible
- Screen reader announces all controls with clear labels
- High contrast mode makes lines 1.5x thicker

## Regression Smoke Tests
Ensure backend remains healthy even without direct changes:
```bash
cd ../../apps/api
go test ./...
```

## Deployment Notes
- Ship updated static assets with the web artifact; CDN caching should respect `manifest.json` etag.
- Record bundle-size delta and attach Playwright report to the PR per constitution requirements.
