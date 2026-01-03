# Feature Specification: Barcelona Metro and Bus Integration

**Feature Branch**: `006-metro-bus-integration`
**Created**: 2025-12-27
**Status**: Research
**Input**: User description: "Add to this map the lines, stations and trains of the Barcelona metro station, and the paths, stations and bus of Barcelona bus station. Poll data and get static data as we've done with Rodalies."

**Context**: The current application displays Rodalies (commuter rail) with real-time train positions from GTFS-RT feeds. This feature extends the map to include TMB Metro, TMB Bus, and TRAM Barcelona networks using static GTFS data and estimated real-time positions based on arrival predictions.

## Data Sources Research

### TMB (Transports Metropolitans de Barcelona) - Metro + Bus

| Data Type | Availability | Source | Notes |
|-----------|--------------|--------|-------|
| **Static GTFS** | Available | `https://api.tmb.cat/v1/static/datasets/gtfs.zip` | Weekly updates, requires API key |
| **Static GTFS (Alt)** | Available | AMB Open Data / Transitland | No auth required |
| **Real-time GPS** | NOT Available | - | Internal system only, not exposed via public API |
| **Arrival Predictions** | Available | iBus API | Minutes until arrival at stops |

**API Authentication**:
- Register at https://developer.tmb.cat/
- Obtain `APP_ID` and `APP_KEY`
- API Docs: `https://developer.tmb.cat/api-docs/v1/ibus`

### TRAM Barcelona (Trambaix + Trambesòs)

| Data Type | Availability | Source | Notes |
|-----------|--------------|--------|-------|
| **Static GTFS** | Available | https://opendata.tram.cat/ | 6 lines, ~30km network |
| **Real-time GPS** | Unknown | - | Requires investigation |

### FGC (Ferrocarrils de la Generalitat) - Future Consideration

| Data Type | Availability | Source | Notes |
|-----------|--------------|--------|-------|
| **Static GTFS** | Available | https://dadesobertes.fgc.cat/ | Barcelona-Vallès, Llobregat-Anoia lines |
| **Real-time GPS** | NOT Available | - | No public API |

## Clarifications

### Session 2025-12-27

- Q: Which networks to include in Phase 1? → A: TMB Metro, TMB Bus, TRAM (FGC as future consideration)
- Q: How to handle lack of real-time GPS for Metro/Bus? → A: Estimate positions using iBus arrival predictions + schedule data
- Q: Should all networks share the same visualization style? → A: TBD (Metro underground vs Bus on streets)
- Q: How to differentiate between transport types visually? → A: TBD (different 3D models, icons, colors)
- Q: Should users be able to filter by transport type? → A: TBD
- Q: How to handle Metro underground tunnels (no visible path)? → A: TBD

## User Scenarios & Testing

### User Story 1 - View Metro Lines and Stations (Priority: P1)

Users need to see Barcelona Metro lines displayed on the map with their respective stations, similar to how Rodalies lines are currently shown.

**Why this priority**: Foundation for all Metro features. Without lines and stations, real-time data has no context.

**Acceptance Scenarios**:

1. **Given** the map is loaded, **When** Metro layer is enabled, **Then** all Metro lines (L1-L11, plus FM lines) are displayed with correct colors

2. **Given** Metro lines are displayed, **When** viewing stations, **Then** station markers show at correct positions with names

3. **Given** a Metro interchange station (e.g., Passeig de Gràcia), **When** viewing the station, **Then** all connecting lines are indicated

---

### User Story 2 - View Bus Routes and Stops (Priority: P2)

Users need to see Barcelona Bus routes and stops on the map, with the ability to filter by route.

**Why this priority**: Complements Metro coverage but less visual priority due to higher complexity (100+ routes).

**Acceptance Scenarios**:

1. **Given** the map is loaded, **When** Bus layer is enabled, **Then** bus routes are displayed

2. **Given** a bus route is selected, **When** viewing the route, **Then** all stops along the route are highlighted

---

### User Story 3 - Estimated Metro/Bus Positions (Priority: P1)

Without real-time GPS, users need estimated vehicle positions based on iBus arrival predictions and schedule data, similar to the predictive algorithm implemented for Rodalies.

**Why this priority**: Core value proposition - showing "where vehicles are" even without GPS data.

**Acceptance Scenarios**:

1. **Given** iBus reports "Metro L1 arriving at Station X in 2 minutes", **When** viewing L1, **Then** a train is shown approaching Station X at estimated position

2. **Given** multiple trains on the same line, **When** viewing the line, **Then** each train is positioned based on its next predicted arrival

3. **Given** arrival prediction data is stale (>5 min old), **When** viewing vehicles, **Then** positions are marked as "uncertain" or hidden

---

### User Story 4 - View TRAM Lines and Stops (Priority: P2)

Users need to see TRAM Barcelona lines (T1-T6) with their stops, completing the public transport visualization.

**Acceptance Scenarios**:

1. **Given** the map is loaded, **When** TRAM layer is enabled, **Then** all TRAM lines are displayed with correct colors

2. **Given** TRAM lines are displayed, **When** viewing stops, **Then** stop markers show at correct positions

---

### User Story 5 - Transport Type Filtering (Priority: P2)

Users need to filter the map by transport type (Rodalies, Metro, Bus, TRAM) to reduce visual clutter.

**Acceptance Scenarios**:

1. **Given** all transport layers are loaded, **When** user toggles Metro off, **Then** Metro lines and vehicles are hidden

2. **Given** user has filtered to "Metro only", **When** clicking a station, **Then** only Metro information is shown

## Technical Constraints

1. **No real-time GPS for Metro/Bus**: Must rely on schedule + iBus predictions for position estimation
2. **iBus API rate limits**: TBD - need to determine polling frequency limits
3. **Large route count**: ~100+ bus routes vs ~15 rail lines - performance consideration
4. **Underground visualization**: Metro runs underground - need to decide visualization approach
5. **3D models**: May need different vehicle models for Metro, Bus, TRAM vs Rodalies trains

## Out of Scope (Phase 1)

- FGC integration (no real-time data available)
- Night bus (Nitbus) special handling
- Airport shuttle integration
- Accessibility information per station
- Real-time crowding data
- Multi-modal journey planning

## Dependencies

- TMB API registration and key setup
- GTFS data download and preprocessing
- Extension of existing `dataLoader.ts` for multi-network support
- Extension of existing train position algorithm for Metro/Bus estimation
