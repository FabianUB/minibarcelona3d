# Research & Technical Decisions

**Feature**: Real-Time Train Tracking with 3D Visualization
**Date**: 2025-10-24
**Status**: Approved

## Implementation Phasing Strategy

### Decision

Implement in 4 distinct phases: API → 2D Visualization → 3D Models → Rich Features

### Rationale

**Risk Reduction**:
- Building API + 3D rendering + real-time updates simultaneously creates too many failure points
- Hard to debug whether issues are in data layer, network layer, or rendering layer
- Testing becomes exponentially complex with all components in play

**Incremental Value**:
- Phase A delivers testable API that other features can use
- Phase B proves the end-to-end data flow with minimal rendering complexity
- Phase C adds visual polish without blocking core functionality
- Phase D adds UX enhancements on proven foundation

**Technical Validation**:
- Phase A: Validate database schema, query performance, API contracts independently
- Phase B: Validate real-time update mechanism, frontend-backend integration
- Phase C: Validate 3D rendering performance, z-index layering, orientation calculations
- Phase D: Validate complex UI interactions, state management

### Alternatives Considered

**Big Bang Implementation**: Build everything at once following original spec priorities P1-P4
- **Rejected because**: Too many unknowns (PostgreSQL schema, Three.js integration, real-time updates)
- **Risk**: If 3D rendering has issues, entire feature is blocked
- **Testing complexity**: Cannot isolate failures

**Frontend First**: Build UI with mock data, add API later
- **Rejected because**: Real data might not match mocks, leading to rework
- **Risk**: Discover data quality issues late in development

---

## Phase A: Go API + PostgreSQL (MVP)

### PostgreSQL Driver Selection

**Decision**: Use `pgx` (github.com/jackc/pgx/v5)

**Rationale**:

**Performance**:
- Native PostgreSQL protocol implementation (faster than database/sql wrapper)
- Connection pooling built-in (pgxpool)
- Batch queries and prepared statements for high-throughput scenarios
- ~20-30% faster than lib/pq in benchmarks for query-heavy workloads

**Features**:
- Full PostgreSQL feature support (LISTEN/NOTIFY, COPY, arrays, JSON types)
- Both low-level driver (pgx) and database/sql compatibility (pgx/stdlib)
- Built-in support for context cancellation and timeouts
- Excellent logging and observability hooks

**Maintenance**:
- Actively maintained (last release within 3 months as of 2025)
- Large community adoption (used by Supabase, CockroachDB tooling)
- Comprehensive documentation and examples
- Go 1.18+ generics support for type-safe queries

**Specific Needs**:
- Querying `rt_rodalies_vehicle_current` table requires fast reads (<100ms)
- Connection pooling essential for handling frontend polling every 10-30s
- JSON/JSONB support useful for trip stop arrays

**Alternatives Considered**:

**lib/pq (database/sql compatible)**:
- Mature and stable
- **Rejected because**: Slower performance, maintenance mode (no new features), no connection pooling

**GORM or sqlx**:
- Higher-level abstractions
- **Rejected because**: Unnecessary overhead for simple read queries, adds complexity

---

## Phase B: 2D Visualization (Proof of Concept)

### Rendering Approach

**Decision**: Use Mapbox GL JS Markers (DOM-based) for initial 2D implementation

**Rationale**:

**Simplicity**:
- Built-in Mapbox `Marker` API requires minimal code
- Automatic map coordinate → screen coordinate transformation
- Built-in click event handling
- No custom WebGL or canvas management needed

**Fast Iteration**:
- Proves real-time update mechanism works
- Validates API polling strategy
- Tests marker clustering if needed for many trains
- Quick to build and test

**Known Limitations** (acceptable for proof of concept):
- DOM-based rendering less performant than WebGL at 100+ markers
- No z-index control relative to Mapbox layers (markers always on top)
- Limited animation capabilities (will address in Phase C)

**Alternatives Considered**:

**GeoJSON Layer with Symbols**:
- WebGL-based, better performance
- **Rejected for Phase B because**: More complex data updates, harder to make clickable
- **Note**: Could revisit in Phase C if marker performance insufficient

**Canvas 2D Overlay**:
- Custom rendering
- **Rejected because**: Requires manual coordinate transformation, event handling, no advantage over markers for POC

---

## Phase C: 3D Model Upgrade (Enhancement)

### Three.js Integration

**Decision**: Use Mapbox GL JS Custom Layer API with Three.js renderer

**Rationale**:

**Official Pattern**:
- Mapbox provides `CustomLayerInterface` specifically for Three.js integration
- Documented example: https://docs.mapbox.com/mapbox-gl-js/example/add-3d-model/
- Handles camera synchronization, projection matrices automatically

**Layer Control**:
- Custom layers can be inserted at specific z-index positions
- Allows rendering trains "on top of" line geometry layers (FR-005 requirement)
- beforeId parameter in `map.addLayer()` controls stacking order

**Performance**:
- WebGL rendering (same context as Mapbox) - no context switching
- Shared GPU resources
- Can render 100+ simple geometries at 60fps (benchmarked in similar projects)

**Event Handling**:
- Use Raycasting from Three.js for click detection
- Convert screen coords → 3D world coords → intersect with train meshes
- More precise than DOM-based click regions

**Animation/Interpolation**:
- Use Three.js animation loop for smooth position interpolation
- Tween.js or GSAP for easing between updates
- Slerp (spherical linear interpolation) for rotation toward next station

**Alternatives Considered**:

**deck.gl (Uber)**:
- High-performance WebGL visualization library
- **Rejected because**: Additional heavy dependency, Mapbox integration less direct, overkill for ~100 simple models

**Babylon.js**:
- Full-featured 3D engine
- **Rejected because**: Heavier than Three.js, less Mapbox integration examples

---

## Phase D: Rich Features (Polish)

### State Management Strategy

**Decision**: Extend existing MapStateProvider pattern with TrainStateProvider

**Rationale**:

**Consistency**:
- Feature 001 uses Context + Reducer pattern successfully
- Team already familiar with this pattern
- No external state library needed (Redux, Zustand, etc.)

**Separation of Concerns**:
- Train state (positions, selected train, info panel) separate from map state
- Allows trains feature to be developed/tested independently
- Can be removed without touching MapStateProvider

**Implementation**:
- `TrainStateProvider` with `useTrainState()`, `useTrainActions()` hooks
- Reducer handles: `update-positions`, `select-train`, `open-panel`, `close-panel`
- Polling interval managed in provider (useEffect with setInterval)

**Alternatives Considered**:

**Merge into MapStateProvider**:
- Single state tree
- **Rejected because**: Violates separation of concerns, makes MapStateProvider too complex

**External Library (Zustand, Jotai)**:
- Lighter than Redux
- **Rejected because**: Introduces inconsistency, unnecessary for this scale

---

## API Polling vs WebSockets

### Decision

Use HTTP polling every 15-30 seconds (configurable) for Phase B/C. Evaluate WebSockets in Phase D if needed.

### Rationale

**Simplicity**:
- HTTP GET requests easy to implement, test, cache
- No connection state management
- No reconnection logic needed
- Works through any proxy/firewall

**Sufficient for Use Case**:
- Train positions update 10-60s in database (per assumptions)
- Polling at 15-30s matches data freshness
- Users won't notice difference vs WebSocket for this update frequency

**Stateless**:
- Each request independent, easy to debug
- No connection state to manage in backend
- Horizontal scaling trivial (any API instance can serve request)

**When to Reconsider**:
- If database updates increase to <5s intervals
- If we add push notifications/alerts
- If we need bidirectional communication
- If scaling to 1000+ concurrent users

### Alternatives Considered

**WebSockets**:
- Lower latency, push-based
- **Deferred to Phase D evaluation because**: Adds complexity (connection management, reconnect logic), not needed for 15-30s update frequency
- **Note**: Can switch later without frontend state changes (just swap polling hook)

**Server-Sent Events (SSE)**:
- Simpler than WebSockets for server→client only
- **Deferred because**: Similar complexity to WebSockets, less browser support, overkill for current needs

---

## Train Orientation Calculation

### Decision

Calculate bearing from current GPS position to next station GPS coordinates using Haversine formula

### Rationale

**Data Available**:
- Database provides `next_stop_id` for each train
- Station coordinates available from feature 001 data
- Current train position in `latitude`/`longitude` columns

**Formula**:
```
bearing = atan2(
  sin(Δλ) * cos(φ2),
  cos(φ1) * sin(φ2) - sin(φ1) * cos(φ2) * cos(Δλ)
)
where:
  φ1, λ1 = current position (lat, lng)
  φ2, λ2 = next station position (lat, lng)
  Δλ = λ2 - λ1
```

**Accuracy**:
- Good enough for train orientation (not safety-critical navigation)
- Accounts for Earth's curvature (matters for longer distances)
- Standard approach used in mapping libraries

**Performance**:
- Calculated on frontend per render frame (~16ms at 60fps)
- Trigonometric operations fast on modern JS engines
- Can pre-calculate and cache if needed

**Alternatives Considered**:

**Store Heading in Database**:
- Use `bearing` field if feed provides it
- **Rejected because**: Database schema doesn't show heading field, would require backend changes
- **Note**: Could add later if feed data includes it

**Use Line Geometry Tangent**:
- Calculate direction from line shape at train's position
- **Rejected because**: Requires complex geometry intersection, less accurate when train off-route

---

## Testing Strategy

### Phase A (API)

**Unit Tests**:
- Handler functions with mock repository
- Model validation logic
- Error handling paths

**Integration Tests**:
- Full API request → PostgreSQL → response cycle
- Use testcontainers-go for isolated PostgreSQL instance
- Test data fixtures for repeatable scenarios

**Contract Tests**:
- OpenAPI spec validation
- Response schema matches TypeScript types (generated from OpenAPI)

### Phase B (2D Visualization)

**Unit Tests**:
- `useTrainPositions` hook with mocked fetch
- Marker creation/update logic
- Polling interval behavior

**Integration Tests**:
- Mock Service Worker (MSW) for API responses
- Test marker positions match API data
- Test marker updates on polling

**E2E Tests (Playwright)**:
- Load map, verify markers appear
- Wait 30s, verify markers move
- Test marker click (prepare for Phase D panel)

### Phase C (3D Models)

**Unit Tests**:
- Three.js scene setup
- Geometry creation
- Orientation calculation (bearing formula)

**Visual Regression Tests**:
- Playwright screenshots of 3D scene
- Compare against baseline images
- Detect rendering regressions

**Performance Tests**:
- Measure FPS with 100 train models
- Verify <16ms frame time (60fps target)
- Use Chrome DevTools Performance API

### Phase D (Rich Features)

**Unit Tests**:
- TrainStateProvider reducer
- Info panel component
- Stop list rendering

**E2E Tests**:
- Click train → panel opens
- Panel displays correct data
- Close panel behavior
- Line filtering integration

---

## Summary of Decisions

| Decision | Choice | Phase |
|----------|--------|-------|
| PostgreSQL Driver | pgx/v5 | A |
| API Pattern | REST with polling | A-B |
| Initial Rendering | Mapbox Markers (2D) | B |
| 3D Integration | Custom Layer + Three.js | C |
| State Management | Context + Reducer | D |
| Orientation | Haversine bearing to next station | C |
| Testing | Unit + Integration + E2E (Playwright) | All |

**Next Step**: Proceed to Phase 1 (data-model.md and contracts/api.yaml)
