# Research: Station Visualization and Interaction

**Feature**: 004-station-visualization
**Date**: 2025-11-14
**Status**: Complete

## Overview

This document consolidates research findings for implementing interactive station markers on the Rodalies map, covering marker rendering strategies, positioning algorithms, state management patterns, and UI component approaches.

---

## R1: Mapbox GL Marker Rendering Strategy

### Decision
Use **Mapbox GL Layers** (circle + symbol layers) instead of DOM-based markers for rendering 200+ stations.

### Rationale
- **Performance**: GL layers are GPU-accelerated and can handle thousands of markers at 60 FPS, easily meeting the 30 FPS requirement with 200+ stations
- **Existing Pattern**: Project already uses GL layers for railway lines (`rodalies-lines` layer), ensuring visual consistency
- **Zoom-responsive**: GL layers support data-driven styling with zoom-based interpolation out-of-the-box
- **Event Handling**: Mapbox provides queryRenderedFeatures() for click/hover detection on GL layers

### Alternatives Considered
- **DOM Markers** (mapbox-gl Marker class): Rejected due to poor performance with 200+ markers (creates individual DOM nodes, frequent reflow/repaint)
- **Canvas-based custom layer**: Rejected as unnecessarily complex; built-in circle/symbol layers provide needed functionality

### Implementation Notes
- Create two layers:
  - `stations-circles`: Circle layer for the marker background
  - `stations-labels`: Symbol layer for station names (optional, zoom-dependent)
- Use GeoJSON source with `Station.geojson` data
- Data-driven styling: `circle-color` based on line count, `circle-radius` based on zoom level

**References**:
- Mapbox GL JS Performance Best Practices: https://docs.mapbox.com/mapbox-gl-js/guides/performance/
- Existing implementation: `apps/web/src/features/map/RodaliesLinesLayer.tsx`

---

## R2: Radial Offset Positioning Algorithm

### Decision
Implement **polar coordinate-based radial offset** for overlapping station markers.

### Rationale
- **Maintains Geographic Context**: Offsets are minimal (5-15px radius), keeping stations near true location
- **Guaranteed Non-Overlap**: Polar distribution ensures angular separation between markers
- **Predictable**: Same station group always renders in same pattern (deterministic based on station ID sort)
- **Performance**: Pre-compute offsets once per zoom level change, not per frame

### Algorithm Outline
```typescript
function calculateRadialOffsets(
  stations: Station[],
  centerLngLat: LngLat,
  zoom: number
): StationOffset[] {
  const overlapping = findOverlappingStations(stations, zoom);
  const groups = clusterByProximity(overlapping, OVERLAP_THRESHOLD_PX);

  return groups.flatMap(group => {
    const radius = calculateOffsetRadius(group.length, zoom);
    return group.map((station, index) => ({
      stationId: station.id,
      offset: polarToCartesian(
        radius,
        (index / group.length) * 2 * Math.PI
      )
    }));
  });
}
```

### Alternatives Considered
- **Force-directed layout**: Rejected as too computationally expensive for real-time zoom changes
- **Grid-based snapping**: Rejected as less intuitive and can push markers far from true position
- **No offset (allow overlap with z-index)**: Rejected per clarification decision - violates SC-007 (zero overlap)

### Implementation Notes
- Use viewport pixel coordinates for overlap detection
- Threshold: 20px minimum separation at zoom 10, scale with zoom
- Offset radius: 8-15px depending on group size
- Store offsets in layer paint properties using data-driven expressions

**References**:
- Similar approach: Google Maps marker clustering (simplified version)
- Polar math: MDN Math.cos/sin documentation

---

## R3: Station State Management Pattern

### Decision
Extend **existing MapStateProvider** with station-specific state instead of creating separate Zustand store.

### Rationale
- **Consistency**: Aligns with project's established Context + Reducer pattern (see CLAUDE.md)
- **Integration**: Station selection naturally integrates with line highlighting state (both affect map UI)
- **Simplicity**: Avoids state synchronization issues between multiple stores
- **No Cross-Feature Complexity**: Station state doesn't need to be shared outside map context

### State Extensions
```typescript
interface MapUIState {
  // ... existing fields
  selectedStationId: string | null;
  stationPanelOpen: boolean;
  stationLoadError: string | null;
}

interface MapActions {
  // ... existing actions
  selectStation(stationId: string | null): void;
  setStationPanelOpen(open: boolean): void;
  retryStationLoad(): void;
}
```

### Alternatives Considered
- **Separate Zustand store** (like trains feature): Rejected - station state is tightly coupled to map state (highlighting, viewport), not an independent concern
- **Local component state**: Rejected - panel state needs to persist across panel close/open cycles

### Implementation Notes
- Add station-related cases to existing mapStateReducer
- Station panel visibility controlled via `activePanel` enum (add `'stationInfo'` option)
- Error retry triggers dataLoader cache invalidation

**References**:
- Existing pattern: `apps/web/src/state/map/MapStateProvider.tsx`
- Train state (different pattern): `apps/web/src/state/trains/` (uses Zustand for cross-feature needs)

---

## R4: Detail Panel Component Architecture

### Decision
Use **Radix UI Dialog** with fixed positioning, desktop/mobile variants following train info panel pattern.

### Rationale
- **Consistency**: Project already uses Radix Dialog for train info panel (see `TrainInfoPanel*.tsx`)
- **Accessibility**: Radix provides ARIA attributes, focus management, escape handling out-of-the-box (meets FR-008)
- **Responsive**: Separate desktop/mobile variants allow optimized layouts per viewport
- **Fixed Position**: Matches clarification decision (Q5) and existing panel pattern

### Component Structure
```
StationInfoPanel (wrapper)
├── StationInfoPanelDesktop (>768px)
│   └── Dialog with fixed bottom-right positioning
└── StationInfoPanelMobile (<768px)
    └── Dialog with bottom sheet behavior
```

### Alternatives Considered
- **Mapbox GL Popup**: Rejected - doesn't support fixed positioning, poor mobile UX, harder accessibility
- **Custom modal**: Rejected - Radix provides battle-tested implementation, no need to reinvent
- **Tooltip-style popover**: Rejected - insufficient space for multi-line station details

### Implementation Notes
- Desktop: 360px width, 16px padding, bottom-right corner with 24px margins
- Mobile: Full-width bottom sheet, slides up from bottom
- Content: Station name (heading), code (subtitle), line badges (using existing line color data)
- Close triggers: X button, outside click, Escape key (all handled by Radix)

**References**:
- Existing implementation: `apps/web/src/features/trains/TrainInfoPanel*.tsx`
- Radix Dialog docs: https://www.radix-ui.com/primitives/docs/components/dialog

---

## R5: Hover Tooltip Implementation

### Decision
Use **Mapbox GL Popup** with `closeButton: false, closeOnClick: false` for hover tooltips.

### Rationale
- **Lightweight**: Mapbox Popup is optimized for ephemeral content like tooltips
- **Native Integration**: Works seamlessly with Mapbox event system (mousemove/mouseleave)
- **Performance**: Single Popup instance reused across all stations (update content/position on hover)
- **Positioning**: Automatically handles viewport edges, avoids clipping

### Behavior
- Trigger: `mouseenter` on station circle layer (200ms debounce to prevent flicker)
- Content: Station name only (line count after 500ms - stretch goal)
- Dismiss: `mouseleave` or map pan/zoom
- Mobile: Not shown (hover not available on touch devices per assumption)

### Alternatives Considered
- **Custom div positioned via CSS**: Rejected - manual viewport edge detection complex, Popup handles it
- **Radix Tooltip**: Rejected - designed for DOM elements, not map features
- **Canvas-rendered tooltip**: Rejected - unnecessary complexity, no accessibility benefits

### Implementation Notes
```typescript
const popup = new mapboxgl.Popup({
  closeButton: false,
  closeOnClick: false,
  maxWidth: '200px',
  className: 'station-hover-tooltip'
});

map.on('mouseenter', 'stations-circles', (e) => {
  const station = e.features[0].properties;
  popup.setLngLat(e.lngLat)
    .setHTML(`<div>${station.name}</div>`)
    .addTo(map);
});

map.on('mouseleave', 'stations-circles', () => {
  popup.remove();
});
```

**References**:
- Mapbox Popup API: https://docs.mapbox.com/mapbox-gl-js/api/markers/#popup
- Hover interaction example: Mapbox GL JS examples gallery

---

## R6: Multi-Line Station Visual Differentiation

### Decision
Use **concentric circles** with outer ring color derived from dominant line.

### Rationale
- **Clear Visual Distinction**: Two circles immediately signal "multiple lines" vs single circle
- **Color Coding**: Outer ring uses first line's brand color, maintaining visual connection to network
- **Scalable**: Works at all zoom levels, doesn't require complex icons
- **Accessible**: Sufficient contrast between inner (white/light gray) and outer (line color) circles

### Styling
```typescript
// Single-line station
circle-color: ['get', 'lines[0].brand_color'] // Direct line color
circle-radius: [interpolate, zoom, 8, 4, 16, 12]

// Multi-line station
// Outer circle layer
circle-color: ['get', 'lines[0].brand_color']
circle-radius: [interpolate, zoom, 8, 5, 16, 14]

// Inner circle layer
circle-color: '#ffffff'
circle-radius: [interpolate, zoom, 8, 3, 16, 9]
circle-stroke-color: ['get', 'lines[0].brand_color']
circle-stroke-width: 1
```

### Alternatives Considered
- **Multiple colored segments** (pie chart style): Rejected - too complex at small zoom levels, unclear at >3 lines
- **Icon with number badge**: Rejected - requires custom sprite images, harder to maintain, less elegant
- **Size only** (larger = more lines): Rejected - insufficient visual distinction, doesn't meet SC-006

### Implementation Notes
- Pre-process station data to flag multi-line stations: `isMultiLine: lines.length > 1`
- Use filter expressions to render single vs multi-line layers separately
- Outer circle z-index lower than inner to ensure proper layering

**References**:
- Existing line colors: `apps/web/public/rodalies_data/RodaliesLine.json`
- Data-driven styling: Mapbox GL expression specification

---

## R7: Error Recovery & Retry Strategy

### Decision
Implement **exponential backoff retry** with user-visible error state and manual retry button.

### Rationale
- **User Control**: Manual retry button gives users agency (meets FR-018)
- **Resilient**: Exponential backoff prevents server hammering on transient failures
- **Transparent**: Error message informs user of failure (meets FR-017)
- **Graceful Degradation**: Map remains functional without stations (meets FR-019)

### Retry Logic
```typescript
async function loadStationsWithRetry(maxRetries = 3) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await loadStations();
    } catch (error) {
      attempt++;
      if (attempt >= maxRetries) {
        setStationLoadError(error.message);
        return null;
      }
      await delay(Math.pow(2, attempt) * 1000); // 2s, 4s, 8s
    }
  }
}
```

### Error UI
- Banner at top of map viewport: "Failed to load stations. [Retry]"
- Color: Warning yellow background, dark text
- Dismiss: X button or successful retry
- Retry button triggers cache invalidation + fresh load

### Alternatives Considered
- **Silent retry forever**: Rejected - users left wondering why stations don't appear
- **Block entire map**: Rejected - violates FR-019 (keep map functional)
- **Toast notification**: Rejected - too transient, user might miss it

### Implementation Notes
- Use existing dataLoader error propagation
- Add `stationLoadError` to MapState
- Render error banner in `RodaliesMapView` component (top-level)
- Manual retry calls `retryStationLoad()` action, which invalidates cache

**References**:
- Existing error handling: Train data fetch in `TrainLayer3D.tsx`
- Exponential backoff pattern: Common practice, no specific library needed

---

## R8: Testing Strategy

### Decision
**Three-tier testing**: Unit tests for utilities, component tests for UI, E2E tests for user journeys.

### Rationale
- **Matches Project Pattern**: Follows existing test structure (see CLAUDE.md testing strategy)
- **Fast Feedback**: Unit tests catch logic errors quickly (radial offset, marker styling)
- **Integration Confidence**: Component tests verify React + Mapbox GL integration
- **User Validation**: E2E tests confirm real browser behavior across P1/P2/P3 user stories

### Test Coverage

**Unit Tests** (Vitest)
- `markerPositioning.test.ts`: Radial offset calculation, overlap detection
- `markerStyles.test.ts`: Single vs multi-line differentiation logic
- `stationStore.test.ts`: State reducer cases for station selection

**Component Tests** (Vitest + Testing Library)
- `StationInfoPanel.test.tsx`: Panel open/close, content rendering, line badges
- `StationLayer.test.tsx`: Layer add/remove, source data binding

**E2E Tests** (Playwright)
- `stations.spec.ts`:
  - P1: View stations on map (verify markers appear, count matches data)
  - P2: Click station for details (panel opens, shows correct data)
  - P3: Hover for tooltip (desktop only, tooltip appears/disappears)
  - Error recovery: Simulate load failure, verify error banner + retry

### Alternatives Considered
- **Visual regression testing**: Deferred - valuable but not critical for MVP
- **Performance profiling tests**: Deferred - manual FPS monitoring sufficient for initial release

### Implementation Notes
- Use Playwright's `page.locator('[data-testid="station-marker"]')` for reliable selection
- Mock `loadStations()` in component tests to avoid network dependency
- E2E tests run across Chromium/Firefox/WebKit per existing config

**References**:
- Existing tests: `apps/web/src/state/map/MapStateProvider.test.tsx`, `apps/web/e2e/map-default-view.spec.ts`
- Playwright docs: https://playwright.dev/

---

## Summary of Decisions

| Area | Decision | Key Benefit |
|------|----------|-------------|
| Rendering | Mapbox GL Layers | Performance (GPU-accelerated, 30+ FPS) |
| Positioning | Radial offset algorithm | No overlap, minimal geographic displacement |
| State | Extend MapStateProvider | Consistency with project patterns |
| Detail Panel | Radix Dialog (fixed position) | Accessibility, matches train panel |
| Hover Tooltip | Mapbox GL Popup | Lightweight, native integration |
| Visual Differentiation | Concentric circles | Clear multi-line indication |
| Error Handling | Exponential backoff + manual retry | Resilience + user control |
| Testing | Three-tier (unit/component/E2E) | Fast feedback + user validation |

---

**Next Phase**: Phase 1 - Data Model & Contracts
