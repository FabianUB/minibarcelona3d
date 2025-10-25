# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**mini-rodalies-3d** is a 3D interactive map visualization for the Rodalies (Barcelona commuter rail) network. The project uses a monorepo structure with separate frontend (React + Mapbox GL) and backend (Go) applications.

## Repository Structure

```
apps/
  web/           # React 19 + TypeScript 5 frontend with Vite
  api/           # Go 1.25.3 backend API (minimal, for future use)
specs/           # Feature specifications using .specify workflow
  001-show-rodalies-map/  # Current feature implementation
.specify/        # Specification templates and tooling
docs/            # Project documentation
```

## Essential Development Commands

### Frontend (apps/web)

All commands should be run from the `apps/web` directory unless otherwise noted.

**Development:**
```bash
cd apps/web
npm run dev              # Start dev server on http://localhost:5173
```

**Testing:**
```bash
npm test                 # Run unit tests with Vitest
npm run test -- --run    # Run tests once without watch mode
npm run test:e2e         # Run all Playwright E2E tests across browsers
npm run test:e2e -- map-default-view.spec.ts  # Run single E2E spec
npm run test:e2e:ci      # Run E2E tests in CI mode
npm run test:accessibility  # Run accessibility tests (@axe tagged)
```

**Building & Analysis:**
```bash
npm run build            # TypeScript compile + Vite build
npm run lint             # ESLint with TypeScript rules
npm run analyze-bundle   # Build with bundle size visualization
npm run preview          # Preview production build locally
```

### Backend (apps/api)

```bash
cd apps/api
go test ./...            # Run Go tests (regression smoke tests)
```

### Docker Development

```bash
docker-compose up        # Start both web and api services
```

## Architecture

### Frontend State Management

The application uses a **Context + Reducer pattern** for global map state instead of external state management libraries:

- **MapStateProvider** (`apps/web/src/state/map/MapStateProvider.tsx`): Central reducer-based state container
- **Contexts**: Three separate contexts for state, actions, and selectors
  - `MapStateContext`: Read-only state (viewport, UI state, map instance)
  - `MapActionsContext`: State mutation actions
  - `MapHighlightSelectorsContext`: Derived state for line highlighting
- **Hooks**: `useMapState()`, `useMapActions()`, `useMapHighlightSelectors()`, `useMapStore()`

Key state domains:
- **Viewport state**: Camera position, zoom, bounds, padding
- **UI state**: Selected line, highlight mode (none/highlight/isolate), high contrast, legend visibility
- **Map instance**: Mapbox GL Map reference and load status

### Data Loading

Rodalies data is loaded from static JSON/GeoJSON files in `apps/web/public/rodalies_data/`:
- **manifest.json**: Central registry of all data files with paths and checksums
- **Data loader** (`apps/web/src/lib/rodalies/dataLoader.ts`): Caching layer for all data fetching
- All loaders return promises and cache results to prevent duplicate fetches

Data types:
- `RodaliesManifest`: Registry of available data files
- `RodaliesLine`: Line metadata (id, name, colors, patterns)
- `Station`: Station points with line associations
- `LineGeometryCollection`: GeoJSON FeatureCollections for map rendering
- `MapViewport`: Camera configuration with bounds and padding
- `MapUIState`: UI state that can be persisted/restored

### Feature Organization

Features are organized by domain in `apps/web/src/features/`:
- `map/`: Mapbox canvas, controls, viewport management
- `legend/`: Line legend UI and interaction (not yet implemented)

Shared code:
- `lib/`: Reusable utilities (data loaders, etc.)
- `state/`: Global state providers
- `types/`: TypeScript type definitions
- `styles/`: CSS modules/global styles

### Type System

All domain types are defined in `apps/web/src/types/rodalies.ts`:
- GeoJSON types are explicitly defined (not imported from external libs)
- Strict typing for coordinates: `LngLat = [number, number]`
- Feature/FeatureCollection types are generic and reusable
- Pattern types use string aliases for better documentation

## Environment Variables

Required environment variables (see `.env.example`):

**Frontend:**
- `MAPBOX_TOKEN`: Mapbox API token for map tiles (required)
- `VITE_API_BASE`: API base URL (default: `/api`)
- `VITE_APP_NAME`: Application name

**Backend:**
- `PORT`: API server port (default: 8080)
- `ALLOWED_ORIGINS`: CORS allowed origins
- `DATABASE_URL`: PostgreSQL connection string (future use)

## Testing Strategy

Three-tier testing approach (see `docs/TESTS.md`):

1. **Unit & Component Tests** (Vitest + Testing Library)
   - Fast feedback on data loaders, reducers, hooks
   - Run individual tests: `npm test -- legend-store`

2. **End-to-End Tests** (Playwright)
   - Real browser testing across Chromium, Firefox, WebKit
   - Tests located in `apps/web/e2e/*.spec.ts`
   - Separate accessibility project with `@axe` tag filtering

3. **Static Analysis** (ESLint)
   - TypeScript-aware linting with React-specific rules

## Key Files to Understand

- `apps/web/src/App.tsx`: Application root with MapStateProvider
- `apps/web/src/state/map/MapStateProvider.tsx`: Core state management reducer
- `apps/web/src/lib/rodalies/dataLoader.ts`: Data fetching and caching layer
- `apps/web/src/types/rodalies.ts`: Complete type system
- `apps/web/vite.config.ts`: Vite configuration with test setup
- `apps/web/playwright.config.ts`: E2E test configuration with multi-browser matrix

## Development Workflow

The project uses the `.specify` workflow for feature development:
- Feature specs in `specs/<feature-id>/`
- Each spec has `spec.md`, `plan.md`, `tasks.md`, `quickstart.md`
- Slash commands available: `/speckit.specify`, `/speckit.plan`, `/speckit.tasks`, etc.

## Common Patterns

**Adding a new map feature:**
1. Define types in `apps/web/src/types/rodalies.ts`
2. Add state to MapState/MapActions in `apps/web/src/state/map/types.ts`
3. Add reducer case in `apps/web/src/state/map/MapStateProvider.tsx`
4. Create feature component in `apps/web/src/features/<feature>/`
5. Write unit tests for state logic
6. Write E2E tests for user journeys

**Data loading pattern:**
```typescript
// Always use the data loader cache
const viewport = await loadMapViewport();
const stations = await loadStationList();
```

**Accessing map state:**
```typescript
// In React components
const state = useMapState();
const actions = useMapActions();
const { isLineHighlighted } = useMapHighlightSelectors();

// Or get all at once
const [state, actions, selectors] = useMapStore();
```

## Active Technologies
- PostgreSQL database with `rt_rodalies_vehicle_current` table (documented in `/docs/DATABASE_SCHEMA.md`) (002-realtime-train-tracking)

## Recent Changes
- 002-realtime-train-tracking: Added PostgreSQL database with `rt_rodalies_vehicle_current` table (documented in `/docs/DATABASE_SCHEMA.md`)
