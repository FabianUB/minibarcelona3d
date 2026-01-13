# MiniBarcelona3D Development Guidelines

Last updated: 2025-01-12

## Overview

MiniBarcelona3D is a 3D interactive map visualization for the Barcelona public transport network. It displays real-time positions of Rodalies (commuter rail), Metro, Bus, Tram, and FGC trains/vehicles.

## Active Technologies

### Frontend (apps/web)
- **Framework**: React 19.1, TypeScript 5.9
- **Build**: Vite 7.1
- **3D Rendering**: Three.js 0.180 via Mapbox Custom Layer API
- **Maps**: Mapbox GL JS 3.4
- **UI**: ShadCN UI, Radix UI (dialogs, popovers), Tailwind CSS 4.1
- **Testing**: Vitest 2.1, Playwright 1.48

### Backend (apps/api)
- **Language**: Go 1.25.3
- **Database**: PostgreSQL (for real-time train tracking data)

### Data Poller (apps/poller)
- **Language**: Go
- **Purpose**: Fetches real-time transit data and populates database

## Project Structure

```
apps/
  web/           # React frontend (main application)
  api/           # Go backend API
  poller/        # Go data poller service
specs/           # Feature specifications (.specify workflow)
docs/            # Project documentation
```

## Commands

### Frontend Development
```bash
cd apps/web
npm run dev              # Start dev server on http://localhost:5173
npm test                 # Run unit tests with Vitest
npm run test:e2e         # Run Playwright E2E tests
npm run build            # Production build
npm run lint             # ESLint with TypeScript rules
```

### Backend
```bash
cd apps/api
go test ./...            # Run Go tests
```

## Code Style

- TypeScript: Strict mode enabled, explicit return types
- React: Functional components with hooks, Context + Reducer pattern for state
- Three.js: Mapbox Custom Layer API for 3D integration
- Comments: Explain "why" not "what" - code should be self-documenting

## Key Architectural Decisions

1. **State Management**: Context + Reducer pattern (no Redux)
2. **3D Vehicles**: Three.js meshes via Mapbox Custom Layer API
3. **Hit Detection**: Oriented Bounding Rectangle (OBR) for accurate train selection
4. **Data Loading**: Static GeoJSON files with client-side caching
5. **Railway Rendering**: Single layer approach (Mini Tokyo 3D style)

## Recent Changes

- 010-deployment-preparation: Added ServiceUnavailable page for Mapbox rate limit handling
- 009-obr-hit-detection: Implemented Oriented Bounding Rectangle hit detection for all transit types
- 008-optimizations: Unified line/stop layer components with factory patterns
- 004-station-visualization: Interactive station markers with info panels
- 003-train-line-colors-zoom: Zoom-responsive train scaling, hover outlines
- 002-realtime-train-tracking: PostgreSQL integration for real-time data

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
