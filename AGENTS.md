# MiniBarcelona3D Development Guidelines

Last updated: 2025-01-13

## Overview

MiniBarcelona3D is a 3D interactive map visualization for Barcelona's public transport network. It displays real-time positions of Rodalies, Metro, Bus, Tram, and FGC vehicles.

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Poller    │────▶│   SQLite    │◀────│    API      │
│   (Go)      │     │  transit.db │     │   (Go)      │
└─────────────┘     └─────────────┘     └─────────────┘
       │                                       │
       ▼                                       ▼
┌─────────────┐                         ┌─────────────┐
│  GeoJSON    │◀────────────────────────│    Web      │
│   Files     │                         │  (React)    │
└─────────────┘                         └─────────────┘
```

## Project Structure

```
apps/
  web/           # React 19 + TypeScript frontend
  api/           # Go backend API (serves SQLite data)
  poller/        # Go service (polls Renfe/TMB APIs)
specs/           # Feature specifications
```

## Commands

```bash
# Development (Docker - recommended)
docker-compose up

# Frontend only
cd apps/web && npm run dev

# Tests
cd apps/web && npm test
cd apps/web && npm run test:e2e

# Production deploy
docker compose -f docker-compose.prod.yml up -d --build
```

## Environment Variables

```bash
# Frontend (required)
VITE_MAPBOX_TOKEN=pk.xxx

# Backend/Poller (required)
TMB_APP_ID=xxx
TMB_APP_KEY=xxx
SQLITE_DATABASE=/data/transit.db
```

## Technologies

| Layer | Stack |
|-------|-------|
| Frontend | React 19, TypeScript 5.9, Vite 7, Three.js, Mapbox GL |
| UI | ShadCN UI, Radix UI, Tailwind CSS 4 |
| Backend | Go 1.23, SQLite |
| Deploy | Docker, Caddy, GitHub Actions |

## Key Patterns

1. **State**: Context + Reducer pattern (no Redux)
2. **3D**: Three.js via Mapbox Custom Layer API
3. **Hit Detection**: Oriented Bounding Rectangle (OBR)
4. **Error Handling**: Circuit breaker + retry with backoff
5. **Data**: Static GeoJSON + real-time API polling

## Code Style

- TypeScript strict mode
- Functional React components with hooks
- Comments explain "why", not "what"

## Recent Changes

- **010-deployment-preparation**: Production config, error handling, circuit breaker
- **009-obr-hit-detection**: OBR hit detection for 3D models
- **008-optimizations**: Unified GenericLineLayer/GenericStopLayer
- **006-metro-bus-integration**: Metro, Bus, Tram, FGC support

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
