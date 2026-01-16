# [MiniBarcelona3D](https://minibarcelona3d.com)

A 3D visualization of Barcelona's public transport network, inspired by [Mini Tokyo 3D](https://minitokyo3d.com/).

![MiniBarcelona3D](screenshot.png)

## Features

- **Real-time vehicle tracking** for Rodalies and Metro
- **Schedule-based positions** for Bus, Tram, and FGC
- **Interactive 3D trains** with click-to-select and hover effects
- **Vehicle list panel** showing all active trains with search and filtering
- **Live delay information** from GTFS-RT feeds
- **Network health monitoring** at `/status`

## Architecture

```
apps/
  web/      # React frontend with Three.js 3D rendering
  api/      # Go backend API (SQLite)
  poller/   # Real-time data polling service
```

### Data Sources

| Network | Source | Type |
|---------|--------|------|
| Rodalies | Renfe GTFS-RT | Real-time GPS |
| Metro | TMB API | Real-time schedule |
| Bus | TMB GTFS | Static schedule |
| Tram | TRAM GTFS | Static schedule |
| FGC | FGC GTFS | Static schedule |

## Getting Started

### Prerequisites

- Docker and Docker Compose
- [Mapbox](https://account.mapbox.com/) API token
- [TMB Developer](https://developer.tmb.cat/) API credentials

### Setup

```bash
# Clone and configure
git clone https://github.com/FabianUB/mini-rodalies-3d.git
cd mini-rodalies-3d
cp .env.example .env
# Edit .env with your VITE_MAPBOX_TOKEN, TMB_APP_ID, TMB_APP_KEY
```

### Run with Docker (Recommended)

```bash
docker compose up
```

Open http://localhost:5173

### Run Frontend Only

```bash
cd apps/web
npm install
npm run dev
```

## Built With

- [React](https://react.dev/) - UI framework
- [Three.js](https://threejs.org/) - 3D rendering
- [Mapbox GL JS](https://docs.mapbox.com/mapbox-gl-js/) - Map visualization
- [Go](https://go.dev/) - Backend services
- [SQLite](https://sqlite.org/) - Database
- [Vite](https://vite.dev/) - Build tool

## License

MIT

## Acknowledgments

- [Mini Tokyo 3D](https://minitokyo3d.com/) - Principal inspiration
- Transit data from Rodalies de Catalunya, TMB, FGC, and TRAM
