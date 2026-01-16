# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**MiniBarcelona3D** is a 3D interactive map visualization for the Barcelona public transport network. It displays real-time positions of Rodalies (commuter rail), Metro, Bus, Tram, and FGC trains/vehicles. The project uses a monorepo structure with frontend (React + Mapbox GL), backend API (Go), and data polling service (Go).

## Repository Structure

```
apps/
  web/           # React 19 + TypeScript 5 frontend with Vite
  api/           # Go backend API serving transit data
  poller/        # Go service polling real-time transit data
specs/           # Feature specifications using .specify workflow
docs/            # Project documentation
data/            # GTFS static data (gitignored)
```

## Essential Development Commands

### Frontend (apps/web)

```bash
cd apps/web
npm run dev              # Start dev server on http://localhost:5173
npm test                 # Run unit tests with Vitest
npm run test -- --run    # Run tests once without watch mode
npm run test:e2e         # Run Playwright E2E tests
npm run build            # TypeScript compile + Vite build
npm run lint             # ESLint with TypeScript rules
```

### Docker Development (Recommended)

```bash
# Start all services (web, api, poller, init-db)
docker-compose up

# Production deployment
docker compose -f docker-compose.prod.yml up -d --build
```

### Backend (apps/api)

```bash
cd apps/api
go test ./...            # Run Go tests
```

## Architecture

### Service Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Poller    │────▶│   SQLite    │◀────│    API      │
│  (Go svc)   │     │  transit.db │     │  (Go svc)   │
└─────────────┘     └─────────────┘     └─────────────┘
       │                                       │
       ▼                                       ▼
┌─────────────┐                         ┌─────────────┐
│  GeoJSON    │◀────────────────────────│    Web      │
│   Files     │                         │  (React)    │
└─────────────┘                         └─────────────┘
```

- **Poller**: Fetches real-time data from Renfe GTFS-RT and TMB APIs every 30s
- **API**: Serves transit data from SQLite database
- **Web**: React frontend with Mapbox GL and Three.js for 3D rendering

### Frontend State Management

The application uses a **Context + Reducer pattern** for global map state:

- **MapStateProvider** (`apps/web/src/state/map/MapStateProvider.tsx`): Central reducer-based state
- **Contexts**: Separate contexts for state, actions, and selectors
- **Hooks**: `useMapState()`, `useMapActions()`, `useMapHighlightSelectors()`, `useMapStore()`

### Data Flow

1. **Poller** fetches real-time positions → writes to SQLite + updates GeoJSON files
2. **API** reads from SQLite → serves to frontend via REST endpoints
3. **Web** loads static GeoJSON for lines/stations + polls API for vehicle positions

### Feature Organization

```
apps/web/src/features/
  map/           # Mapbox canvas, controls, ServiceUnavailable page
  trains/        # Rodalies train visualization (3D)
  transit/       # Generic transit vehicle layer (Metro, Bus, Tram, FGC)
  stations/      # Station markers and info panels
  controlPanel/  # Network selection UI
  status/        # Health monitoring and observability (/status page)
  metro/, bus/, tram/, fgc/  # Network-specific layers
```

## Environment Variables

### Required (Frontend)

```bash
VITE_MAPBOX_TOKEN=pk.xxx   # Mapbox API token (required)
VITE_API_BASE=/api         # API base URL
```

### Required (Poller/Backend)

```bash
TMB_APP_ID=xxx             # TMB API credentials
TMB_APP_KEY=xxx            # (for Metro/Bus real-time data)
SQLITE_DATABASE=/data/transit.db
```

See `.env.example` for development and `.env.prod.example` for production.

## Deployment

### Production Stack (Hetzner VPS)

```
Caddy (HTTPS) → Web (Nginx) + API (Go)
                     ↓
              Poller → SQLite
```

**Files:**
- `docker-compose.prod.yml` - Production compose file
- `Caddyfile` - Reverse proxy with automatic SSL
- `apps/web/Dockerfile` - Multi-stage build (Node → Nginx)
- `.github/workflows/deploy.yml` - Auto-deploy on push to main

**Deploy:**
```bash
cp .env.prod.example .env
# Edit .env with your domain and tokens
docker compose -f docker-compose.prod.yml up -d --build
```

## Key Patterns

### Error Handling (Circuit Breaker)

```typescript
import { fetchWithRetry, CircuitOpenError } from '../lib/api/fetchWithRetry';

// Automatic retry with exponential backoff + circuit breaker
const response = await fetchWithRetry(url, {
  logPrefix: 'Train API',
  timeoutMs: 15000,
  useCircuitBreaker: true,
});
```

Circuit breaker prevents hammering failed APIs:
- Opens after 5 consecutive failures
- Half-open test after 30 seconds
- See `apps/web/src/lib/api/circuitBreaker.ts`

### Structured Error Logging

```typescript
import { logError, logApiError } from '../lib/logging/errorLogger';

// Automatic severity and category detection
logApiError(error, '/api/trains', { userMessage: 'Could not load trains' });
```

### Data Loading with Caching

```typescript
// Always use the data loader cache
const viewport = await loadMapViewport();
const stations = await loadStationList();
const manifest = await loadManifest(); // Falls back to localStorage if offline
```

### 3D Vehicle Rendering

```typescript
// TrainLayer3D uses Mapbox Custom Layer API with Three.js
// Vehicles snap to railway lines with bearing calculations
const snapState = snapToRailwayLine(trainPosition, nextStopPosition, line);
meshManager.applyRailwayBearing(mesh, snapState.bearing, reversed);
```

### Hit Detection (OBR)

```typescript
// Oriented Bounding Rectangle for accurate 3D model clicking
import { MapboxRaycaster } from '../lib/map/MapboxRaycaster';

const raycaster = new MapboxRaycaster(map);
raycaster.onClick((vehicleKey) => selectVehicle(vehicleKey));
```

## Testing Strategy

1. **Unit Tests** (Vitest): Data loaders, reducers, utilities
2. **E2E Tests** (Playwright): User journeys across browsers
3. **Static Analysis** (ESLint): TypeScript-aware linting

```bash
npm test                    # Unit tests
npm run test:e2e            # E2E tests
npm run lint                # Linting
```

## Coding Standards

**Comments should explain "why", not "what":**

```typescript
// BAD: Comment explains what
// Filter trains by route
const routeTrains = trains.filter(t => t.routeId === selectedRoute);

// GOOD: Comment explains why
// Only show trains on selected route to reduce visual clutter
const routeTrains = trains.filter(t => t.routeId === selectedRoute);
```

## Active Technologies

| Layer | Technologies |
|-------|-------------|
| Frontend | React 19, TypeScript 5.9, Vite 7 |
| 3D | Three.js 0.180, Mapbox GL JS 3.4 |
| UI | ShadCN UI, Radix UI, Tailwind CSS 4 |
| Backend | Go 1.23, SQLite |
| Testing | Vitest 2.1, Playwright 1.48 |
| Deploy | Docker, Caddy, GitHub Actions |

## Recent Changes

- **011-observability-reliability**: Health monitoring `/status` page, baseline learning with Welford's algorithm, anomaly detection, uptime tracking
- **010-deployment-preparation**: Production deployment config, error handling with circuit breaker
- **009-obr-hit-detection**: Oriented Bounding Rectangle for accurate 3D model clicking
- **008-optimizations**: Unified GenericLineLayer and GenericStopLayer components
- **006-metro-bus-integration**: Added Metro, Bus, Tram, FGC visualization
- **004-station-visualization**: Interactive station markers with info panels
- **003-train-line-colors-zoom**: Zoom-responsive scaling, hover outlines
