# Research: Barcelona Metro and Bus Data Sources

**Last Updated**: 2025-12-27

## Executive Summary

Barcelona public transport data is fragmented across multiple operators:
- **TMB** operates Metro (8 lines) and most city buses (~100 routes)
- **TRAM** operates the two tram networks (6 lines)
- **FGC** operates commuter rail (separate from Rodalies)
- **AMB** coordinates metropolitan buses outside TMB

Real-time GPS vehicle positions are **NOT publicly available** for Metro or Bus. However, arrival predictions (iBus) can be used to estimate positions using the same predictive algorithm developed for Rodalies.

## TMB (Transports Metropolitans de Barcelona)

### Official Developer Portal
- **URL**: https://developer.tmb.cat/
- **Registration**: Required (free)
- **Authentication**: `APP_ID` + `APP_KEY` per application

### Available APIs

| API | Endpoint | Description |
|-----|----------|-------------|
| Transit | `/v1/transit/...` | Network description (lines, stops, routes) |
| iBus | `/v1/ibus/...` | Real-time arrival predictions at stops |
| Static | `/v1/static/datasets/gtfs.zip` | GTFS download |
| Planner | `/v1/planner/...` | Multi-modal routing |

### iBus API Details

The iBus API provides arrival predictions at bus stops. Key characteristics:
- **Update frequency**: 20-40 second internal cycle
- **Data provided**: Minutes until arrival, not GPS coordinates
- **Coverage**: Bus only (Metro has separate system)

Example endpoint:
```
GET https://api.tmb.cat/v1/ibus/stops/{stop_code}
Headers: app_id: {APP_ID}, app_key: {APP_KEY}
```

Response includes:
- `t-in-min`: Minutes until arrival
- `line`: Bus line number
- `destination`: Destination name

### Metro Real-Time

**Critical Finding**: TMB does not expose Metro real-time positions via public API.

The official TMB app shows "next train" information, but this appears to be:
1. Schedule-based countdown
2. Not GPS-based tracking

For Metro, we must estimate positions using:
- Static schedule (GTFS `stop_times.txt`)
- Known headways per line
- Time-based interpolation between stations

### GTFS Static Data

Available from multiple sources:

1. **TMB Direct** (requires API key):
   ```
   https://api.tmb.cat/v1/static/datasets/gtfs.zip
   ```

2. **AMB Open Data** (no auth):
   https://www.amb.cat/es/web/area-metropolitana/dades-obertes/cataleg/detall/-/dataset/servicios-gtfs-de-tmb/1107694/11692

3. **Transitland** (archived versions):
   https://www.transit.land/feeds/f-sp3e-tmb

GTFS contents (expected):
- `agency.txt` - TMB agency info
- `routes.txt` - Metro + Bus routes (~114 total)
- `stops.txt` - All stops (~3,425)
- `stop_times.txt` - Arrival/departure times
- `trips.txt` - Trip definitions
- `shapes.txt` - Route geometries (critical for map display)
- `calendar.txt` / `calendar_dates.txt` - Service schedules

### Metro Lines Reference

| Line | Color | Terminals | Approx. Stations |
|------|-------|-----------|------------------|
| L1 | Red (#E53935) | Hospital de Bellvitge ↔ Fondo | 30 |
| L2 | Purple (#9C27B0) | Paral·lel ↔ Badalona Pompeu Fabra | 18 |
| L3 | Green (#43A047) | Zona Universitària ↔ Trinitat Nova | 26 |
| L4 | Yellow (#FDD835) | Trinitat Nova ↔ La Pau | 22 |
| L5 | Blue (#1E88E5) | Cornellà Centre ↔ Vall d'Hebron | 26 |
| L9 Nord | Orange (#FB8C00) | La Sagrera ↔ Can Zam | 12 |
| L9 Sud | Orange (#FB8C00) | Aeroport T1 ↔ Zona Universitària | 15 |
| L10 Nord | Light Blue (#29B6F6) | La Sagrera ↔ Gorg | 9 |
| L10 Sud | Light Blue (#29B6F6) | Collblanc ↔ Zona Franca | 6 |
| L11 | Light Green (#8BC34A) | Trinitat Nova ↔ Can Cuiàs | 5 |

### Bus Network Reference

- **Total routes**: ~100+ (day bus, neighborhood bus)
- **Special services**: Nitbus (night), Aerobús (airport)
- **Complexity**: Routes change more frequently than Metro

## TRAM Barcelona

### Open Data Portal
- **URL**: https://opendata.tram.cat/
- **License**: Open data with attribution

### Network Overview

| Network | Lines | Coverage |
|---------|-------|----------|
| Trambaix | T1, T2, T3 | Western Barcelona (Diagonal → suburbs) |
| Trambesòs | T4, T5, T6 | Eastern Barcelona (Ciutadella → Badalona) |

**Recent expansion** (Nov 2024): Trambesòs extended to Verdaguer station, first step toward connecting both networks via Diagonal avenue (expected 2027).

### Data Availability

Static GTFS: Available via opendata.tram.cat
Real-time: Unknown - requires investigation

## FGC (Ferrocarrils de la Generalitat)

### Open Data Portal
- **URL**: https://dadesobertes.fgc.cat/explore/
- **Transitland**: https://www.transit.land/feeds/f-fgc~cat

### Network Overview

| Line | Coverage |
|------|----------|
| Barcelona-Vallès | Plaça Catalunya → Sabadell/Terrassa |
| Llobregat-Anoia | Plaça Espanya → Manresa/Igualada |

### Real-Time Data

**NOT AVAILABLE**: "Neither FGC nor Renfe offers an API where the position of each train can be tracked in real time."

FGC could be added as static-only (lines + stations) without real-time positions.

## AMB (Àrea Metropolitana de Barcelona)

AMB provides a GTFS-RT service for metropolitan buses **excluding TMB buses**:
- **URL**: https://www.amb.cat/en/web/area-metropolitana/dades-obertes/cataleg/detall/-/dataset/gtfs-real-time-bus-service/6332347/11692

This covers inter-city buses in the Barcelona metropolitan area but not city buses operated by TMB.

## Position Estimation Strategy

Since real-time GPS is not available, we'll estimate positions using:

### For Metro

1. **Schedule-based**: Use GTFS `stop_times.txt` to know when trains should be at each station
2. **Headway-based**: Metro runs every 2-5 minutes depending on line and time
3. **Interpolation**: Given headway, place N trains along line at equal intervals
4. **Time adjustment**: Shift positions based on current time vs schedule

Example for L1 (30 stations, 3-minute headway):
- ~10 trains operating simultaneously
- Space trains evenly along route
- Move all trains forward based on elapsed time

### For Bus (iBus available)

1. **Fetch iBus predictions**: Get "X minutes until arrival" for each stop
2. **Reverse-engineer position**: If bus arrives at Stop B in 3 min, and travel time A→B is 5 min, bus is ~60% between A and B
3. **Multiple predictions**: Cross-reference arrivals at consecutive stops for accuracy
4. **Fallback**: Use schedule when iBus unavailable

### Confidence Levels

| Source | Confidence | Visual Indicator |
|--------|------------|------------------|
| Fresh iBus (<1 min) | High | Full opacity |
| Recent iBus (1-3 min) | Medium | 80% opacity |
| Schedule-only | Low | 60% opacity + "estimated" badge |
| No data | None | Hidden or grayed out |

## Next Steps

1. [ ] Download TMB GTFS and analyze structure
2. [ ] Download TRAM GTFS and analyze structure
3. [ ] Register for TMB API and test iBus endpoint
4. [ ] Document schema differences vs Rodalies GTFS
5. [ ] Design data model for multi-network support
6. [ ] Prototype position estimation algorithm
