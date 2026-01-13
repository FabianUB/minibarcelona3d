# [MiniBarcelona3D](https://minibarcelona3d.com)

A 3D visualization of Barcelona's public transport network, inspired by [Mini Tokyo 3D](https://minitokyo3d.com/).

![MiniBarcelona3D](screenshot.png)

## Description

MiniBarcelona3D displays positions of trains and vehicles across Barcelona's transit networks: Rodalies, Metro, Bus, Tram, and FGC. Vehicles are rendered as 3D models on an interactive Mapbox map.

### Current Version

* **Real-time tracking**: Rodalies, Metro
* **Schedule-based**: Bus, Tram, FGC

### Roadmap

* Real-time FGC tracking

## Architecture

```
apps/
  web/      # React frontend
  api/      # Go backend API
  poller/   # Data polling service
```

### Data Sources

| Network | Source | Type |
|---------|--------|------|
| Rodalies | Renfe API | Real-time GPS |
| Metro | TMB API | Real-time schedule |
| Bus | TMB GTFS | Static schedule |
| Tram | TRAM GTFS | Static schedule |
| FGC | FGC GTFS | Static schedule |

## Getting Started

### Dependencies

* Node.js 18+
* Mapbox account with API token

### Installing

```bash
cd apps/web
npm install
cp .env.example .env
# Add your VITE_MAPBOX_TOKEN to .env
```

### Running

```bash
npm run dev
```

Open http://localhost:5173

## Built With

* [React](https://react.dev/) - UI framework
* [Three.js](https://threejs.org/) - 3D rendering
* [Mapbox GL JS](https://docs.mapbox.com/mapbox-gl-js/) - Map visualization
* [Vite](https://vite.dev/) - Build tool

## Authors

Fabian Serrano Lopez

## License

MIT

## Acknowledgments

* [Mini Tokyo 3D](https://minitokyo3d.com/) - Principal inspiration for this project
* Transit data from Rodalies de Catalunya, TMB, FGC, and TRAM
