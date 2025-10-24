# Data Model: Rodalies Lines Map View

## Entity Overview

| Entity | Purpose | Relationships |
|--------|---------|---------------|
| `RodaliesLine` | Canonical definition of each Rodalies rail line rendered on the map. | 1:1 with `LineGeometry`; referenced by `LegendEntry`. |
| `LineGeometry` | GeoJSON feature describing the spatial path of a line plus derived metadata. | Belongs to `RodaliesLine`. |
| `MapViewport` | Default and reset parameters that keep the full network in view. | Referenced by map initialization and reset control. |
| `LegendEntry` | UI binding between a line identifier, styling tokens, and control state. | References `RodaliesLine`; consumes `MapUIState`. |
| `MapUIState` | Client-side store for highlighted line and accessibility theme. | Controls render logic for `LegendEntry` and Mapbox GL JS layers. |
| `Station` | Rodalies stop metadata + point geometry used for overlays/tooltips. | Many-to-many with `RodaliesLine` via `lines` array. |

## RodaliesLine

| Field | Type | Constraints / Notes |
|-------|------|---------------------|
| `id` | `string` | Required, stable identifier (`"R1"`, `"R2"`, etc.); must match GTFS route_id when available. |
| `name` | `string` | Human-readable label (e.g., `"Barcelona – Maçanet-Massanes"`). |
| `short_code` | `string` | 2–3 character shorthand for legend chips. |
| `brand_color` | `string` | HEX color from Rodalies branding; fallback provided if undefined. |
| `default_pattern` | `LinePattern` | CSS pattern token for standard theme. |
| `high_contrast_pattern` | `LinePattern` | Alternative style token triggered by high-contrast mode. |
| `order` | `number` | Optional sorting hint for legend grouping. |

### Validation Rules
- `id` is unique and immutable once published.
- `name`, `short_code`, and `brand_color` must exist for all active lines.
- `default_pattern` and `high_contrast_pattern` cannot both be pure color fills; at least one must introduce stroke patterning to aid distinction.

## LineGeometry

| Field | Type | Constraints / Notes |
|-------|------|---------------------|
| `line_id` | `string` | Foreign key to `RodaliesLine.id`. |
| `feature` | GeoJSON `Feature<LineString|MultiLineString>` | Stored in `LineGeometry.geojson`; coordinates in EPSG:4326. |
| `bbox` | `[number, number, number, number]` | Derived bounding box to accelerate viewport fit. |
| `last_verified_at` | ISO 8601 timestamp | Updated when geometry is refreshed. |

### Validation Rules
- `feature.properties.id` must match `line_id`.
- `bbox` must enclose entire `feature.geometry`.

## MapViewport

| Field | Type | Constraints / Notes |
|-------|------|---------------------|
| `center` | `{ lat: number; lng: number }` | Default center ~Barcelona region; stored as decimals (6 dp). |
| `zoom` | `number` | Default zoom ensuring full network visibility (approx. 8–9). |
| `max_bounds` | `[[lng, lat], [lng, lat]]` | Limits panning to Catalonia envelope. |
| `padding` | `{ top: number; right: number; bottom: number; left: number }` | Responsive padding to keep overlays from hiding lines. |

### State Transitions
- `reset()` returns to stored `center`, `zoom`, and `padding`.
- `fitToLine(line_id)` adjusts zoom/center temporarily while respecting `max_bounds`.

## LegendEntry

| Field | Type | Constraints / Notes |
|-------|------|---------------------|
| `line_id` | `string` | References `RodaliesLine.id`. |
| `label` | `string` | Derived from `RodaliesLine.short_code` + `name`. |
| `theme_tokens` | `{ standard: LinePattern; high_contrast: LinePattern }` | Drives Mapbox GL JS layer styling. |
| `is_highlighted` | `boolean` | Controlled by `MapUIState.selectedLineId`. |

### Validation Rules
- Each `LegendEntry` must exist for every `RodaliesLine`.
- `theme_tokens` must map to actual Mapbox GL JS layer style definitions.

## MapUIState

| Field | Type | Constraints / Notes |
|-------|------|---------------------|
| `selectedLineId` | `string \| null` | `null` when no line is highlighted. |
| `isHighContrast` | `boolean` | Toggled via accessibility control; persisted in `localStorage`. |
| `isLegendOpen` | `boolean` | Tracks ShadCN `Sheet` visibility on small viewports. |

### State Transitions
- `toggleHighContrast()` flips `isHighContrast` and triggers layer style swap.
- `selectLine(line_id)` sets `selectedLineId`; repeated call clears selection.
- `setLegendOpen(boolean)` syncs overlay visibility, ensuring focus restoration per accessibility guidelines.

## Station

| Field | Type | Constraints / Notes |
|-------|------|---------------------|
| `id` | `string` | Stable Rodalies station identifier (matches GTFS `stop_id` when available). |
| `name` | `string` | Human-readable station name. |
| `code` | `string \| null` | Optional commercial code; `null` when unavailable. |
| `lines` | `string[]` | Contains at least one `RodaliesLine.id` served by the station. |
| `geometry` | GeoJSON `Point` | `[lng, lat]` coordinate pair in EPSG:4326. |

### Validation Rules
- Every `Station` feature must list at least one entry in `lines`.
- `geometry.coordinates` must fall within the `MapViewport.max_bounds` envelope.
- Station IDs must be unique and remain stable across releases.

## Derived Structures

### GeoJSON Manifest (`/rodalies_data/manifest.json`)
- `lines`: array listing each `RodaliesLine.id`, checksum (SHA-256), and relative path under `/rodalies_data/lines/`.
- `stations`: object with checksum + path to the station collection (`Station.geojson`).
- `rodalies_lines_path`, `legend_entries_path`, `line_geometries_path`, `map_viewport_path`, `map_ui_state_path`: convenience references to bundle-wide JSON/GeoJSON assets described in this document.
- `updated_at`: timestamp for cache invalidation.
- `viewport`: embedded `MapViewport` defaults for quick bootstrap.

### Station Collection (`/rodalies_data/Station.geojson`)
- GeoJSON `FeatureCollection` containing all `Station` features for overlays and search.
- `features[*].properties.lines` cross-links to associated `RodaliesLine.id` values.

### Aggregated Line Geometry (`/rodalies_data/LineGeometry.geojson`)
- GeoJSON `FeatureCollection` containing all line geometries with `bbox` metadata to speed default fit operations.
- Serves as a fallback when per-line files are unavailable or when precomputing spatial indexes client-side.

### Map Layer Style Tokens
- `LinePattern` enumerates tokens bridging domain entities with Mapbox GL JS style expressions (`"solid-orange"`, `"dashed-purple"`, etc.).
- Both standard and high-contrast tokens must resolve to defined paint/layout expressions in the Mapbox GL JS style configuration.
