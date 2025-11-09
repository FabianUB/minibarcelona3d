# Deprecated E2E Tests

This directory contains E2E tests that are no longer relevant to the current implementation but are kept for historical reference.

## Phase B Tests (2D Markers)

These tests were written for Phase B of the real-time train tracking feature, which used 2D Mapbox markers to display trains.

**Files:**
- `train-markers.spec.ts`: Tests for 2D train marker rendering
- `train-markers-smoke.spec.ts`: Smoke tests for 2D train markers

**Why deprecated:**
Phase B was superseded by Phase C, which implemented 3D train models using Three.js via the Mapbox Custom Layer API. The 2D marker approach is no longer used in the application.

**Current implementation:**
- 3D trains are rendered in `TrainLayer3D.tsx`
- Tests for 3D implementation are in `train-info-panel.spec.ts` and `train-filtering.spec.ts`

---

**Note:** These tests will fail if run against the current implementation since the 2D marker components no longer exist. They are kept here for reference in case we need to understand the original 2D approach.
