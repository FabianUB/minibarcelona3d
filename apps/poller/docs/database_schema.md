# Renfe GTFS-RT Database Schema

> **Note**: This document describes the logical database schema. The actual implementation uses **SQLite**, which stores values as one of: NULL, INTEGER, REAL, TEXT, or BLOB. The type names shown below (e.g., `timestamptz`, `uuid`) indicate the intended data format and are stored as TEXT in SQLite. See `apps/poller/schema.sql` for the actual table definitions.

## Overview

The Renfe real-time ingestion pipeline stores GTFS static reference data alongside real-time snapshots. Dimension tables (`dim_*`) capture the slowly changing reference data downloaded from the static GTFS bundle. Real-time tables (`rt_*`) capture every polling iteration, keyed by a UUID snapshot identifier so that downstream jobs can stage and aggregate the feed history.

## Table Reference

### Dimension Tables (Static GTFS)

#### `dim_routes`

| Column | Type | Description |
|--------|------|-------------|
| `route_id` | `text` | Primary key from GTFS `routes.txt`. |
| `line_code` | `text` | Convenience copy of the short name for grouping lines. |
| `short_name` | `text` | Public-facing line code (if provided). |
| `long_name` | `text` | Descriptive route name. |
| `route_type` | `integer` | GTFS route type (rail, bus, etc.). |
| `color` | `text` | Hex color without `#`. |
| `text_color` | `text` | Preferred text color. |
| `updated_at` | `timestamptz` | Last time the row was refreshed. |

**Notes:** `route_id` is referenced by trips, vehicle positions, alerts, and alert bridge tables.

#### `dim_trips`

| Column | Type | Description |
|--------|------|-------------|
| `trip_id` | `text` | Primary key from GTFS `trips.txt`. |
| `route_id` | `text` | FK to `dim_routes.route_id`. Null when the route is missing from the static bundle. |
| `service_id` | `text` | Service calendar identifier. |
| `shape_id` | `text` | Spatial shape identifier, if present. |
| `block_id` | `text` | Vehicle block grouping. |
| `wheelchair_accessible` | `integer` | Accessibility flag from GTFS. |
| `updated_at` | `timestamptz` | Last refresh time. |

**Notes:** Trip updates and vehicle positions reference `trip_id`, so referential integrity is crucial when the static data is refreshed.

#### `dim_stops`

| Column | Type | Description |
|--------|------|-------------|
| `stop_id` | `text` | Primary key from `stops.txt`. |
| `name` | `text` | Public stop name. |
| `lat` | `double precision` | Latitude in WGS84. |
| `lon` | `double precision` | Longitude in WGS84. |
| `wheelchair_boarding` | `integer` | Accessibility indicator. |
| `updated_at` | `timestamptz` | Last refresh time. |

**Notes:** Referenced by stop times, vehicle positions, trip delays, and alert bridge tables.

#### `dim_stop_times`

| Column | Type | Description |
|--------|------|-------------|
| `trip_id` | `text` | FK to `dim_trips.trip_id`. |
| `stop_sequence` | `integer` | Order of the stop within the trip. |
| `stop_id` | `text` | FK to `dim_stops.stop_id`. |
| `arrival_seconds` | `integer` | Scheduled arrival since midnight, seconds. |
| `departure_seconds` | `integer` | Scheduled departure since midnight, seconds. |

**Indexes:** `dim_stop_times_by_trip_stop_idx` accelerates lookup by `(trip_id, stop_id)`, which the poller uses to derive previous/next stops and scheduled times.

### Real-Time Tables

#### `rt_snapshots`

| Column | Type | Description |
|--------|------|-------------|
| `snapshot_id` | `uuid` | Primary key for each poll iteration. Generated per cycle. |
| `polled_at_utc` | `timestamptz` | UTC timestamp when the poll completed. |
| `vehicle_feed_timestamp_utc` | `timestamptz` | Header timestamp from the vehicle positions feed, if present. |
| `trip_feed_timestamp_utc` | `timestamptz` | Header timestamp from the trip updates feed. |
| `alert_feed_timestamp_utc` | `timestamptz` | Header timestamp from the alerts feed. |

**Usage:** Acts as the parent row for every real-time fact record and allows incremental ingestion by snapshot.

#### `rt_feed_cursors`

| Column | Type | Description |
|--------|------|-------------|
| `feed_type` | `text` | One of `vehicle_positions`, `trip_updates`, or `alerts`. |
| `last_header_timestamp` | `bigint` | Last seen GTFS header timestamp (epoch seconds). |
| `last_snapshot_id` | `uuid` | Associated snapshot that ingested that header. |

**Usage:** Prevents re-processing of stale feed payloads between polling cycles.

#### `rt_vehicle_positions`

| Column | Type | Description |
|--------|------|-------------|
| `snapshot_id` | `uuid` | FK to `rt_snapshots.snapshot_id`. |
| `entity_id` | `text` | Entity identifier from GTFS vehicle feed. |
| `vehicle_id` | `text` | Vehicle descriptor identifier. |
| `vehicle_label` | `text` | Human-readable vehicle label or train number as provided by the feed. |
| `trip_id` | `text` | FK to `dim_trips.trip_id` when the trip exists in static data. |
| `route_id` | `text` | FK to `dim_routes.route_id`. |
| `current_stop_id` | `text` | FK to `dim_stops.stop_id` for the reported stop. |
| `previous_stop_id` | `text` | Derived FK to the previous scheduled stop. |
| `next_stop_id` | `text` | Derived FK to the next scheduled stop. |
| `next_stop_sequence` | `integer` | Sequence of `next_stop_id` in the schedule. |
| `status` | `text` | Vehicle current status (`IN_TRANSIT_TO`, etc.). |
| `latitude` | `double precision` | Reported latitude. |
| `longitude` | `double precision` | Reported longitude. |
| `arrival_delay_seconds` | `integer` | Latest arrival delay at the referenced stop (seconds; positive = late). |
| `departure_delay_seconds` | `integer` | Latest departure delay at the referenced stop. |
| `schedule_relationship` | `text` | Schedule relationship from the trip updates feed. |
| `predicted_arrival_utc` | `timestamptz` | Predicted arrival timestamp, when provided. |
| `predicted_departure_utc` | `timestamptz` | Predicted departure timestamp, when provided. |
| `trip_update_timestamp_utc` | `timestamptz` | Header timestamp of the trip updates snapshot that supplied the delay data. |
| `arrival_delay_seconds` | `integer` | Latest arrival delay at the referenced stop (seconds; positive = late). |
| `departure_delay_seconds` | `integer` | Latest departure delay at the referenced stop. |
| `schedule_relationship` | `text` | Schedule relationship from the trip updates feed. |
| `predicted_arrival_utc` | `timestamptz` | Predicted arrival timestamp, when provided. |
| `predicted_departure_utc` | `timestamptz` | Predicted departure timestamp, when provided. |
| `trip_update_timestamp_utc` | `timestamptz` | Header timestamp of the trip updates snapshot that supplied the delay data. |

**Indexes:** `rt_vehicle_positions_vehicle_idx` supports queries for latest vehicle location per train.

#### `rt_rodalies_vehicle_positions`

Columns mirror `rt_vehicle_positions`, carrying the same delay and prediction fields, but rows are filtered to vehicle labels beginning with `R`.

**Indexes:** `rt_rodalies_vehicle_positions_vehicle_idx` supports queries for latest vehicle location per train.

**Scope:** Derived subset of `rt_vehicle_positions`. Only Rodalies trains (vehicle labels starting with `R`) are ingested into this table.

**Related projections:**
- `rt_rodalies_vehicle_current` maintains one row per active Rodalies train for low-latency queries, carrying the same delay metrics as above plus ingestion timestamps.
- `rt_rodalies_vehicle_history` stores a rolling window (default 24h) of Rodalies rows for short-term playback together with the captured delay data. See `docs/app_vehicle_tables.md` for column-level detail.

#### `rt_trip_delays`

| Column | Type | Description |
|--------|------|-------------|
| `snapshot_id` | `uuid` | FK to `rt_snapshots.snapshot_id`. |
| `trip_id` | `text` | FK to `dim_trips.trip_id`. |
| `stop_id` | `text` | FK to `dim_stops.stop_id`. |
| `stop_sequence` | `integer` | Scheduled sequence taken from `dim_stop_times`. |
| `scheduled_arrival_seconds` | `integer` | Scheduled arrival (seconds after midnight). |
| `scheduled_departure_seconds` | `integer` | Scheduled departure (seconds after midnight). |
| `predicted_arrival_utc` | `timestamptz` | Predicted arrival timestamp. |
| `predicted_departure_utc` | `timestamptz` | Predicted departure timestamp. |
| `arrival_delay_seconds` | `integer` | Positive or negative delay vs schedule. |
| `departure_delay_seconds` | `integer` | Positive or negative departure delay. |
| `schedule_relationship` | `text` | GTFS schedule relationship (`SCHEDULED`, `SKIPPED`, etc.). |

**Indexes:** `rt_trip_delays_trip_idx` speeds up delay history lookups per trip.

#### `rt_alerts`

| Column | Type | Description |
|--------|------|-------------|
| `snapshot_id` | `uuid` | FK to `rt_snapshots.snapshot_id`. |
| `alert_id` | `text` | GTFS alert identifier. |
| `language` | `text` | BCP 47 language code (defaults to `und`). |
| `message` | `text` | Localized alert description. |
| `effect` | `text` | GTFS alert effect category. |
| `cause` | `text` | GTFS alert cause category. |
| `active_start_utc` | `timestamptz` | Earliest active period start from GTFS payload. |
| `active_end_utc` | `timestamptz` | Latest active period end from GTFS payload. |
| `created_at_utc` | `timestamptz` | Feed header timestamp when the alert was observed. |

**Indexes:** `rt_alerts_alert_idx` allows quick retrieval of alert history by alert identifier.

#### `rt_alert_routes`, `rt_alert_stops`, `rt_alert_trips`

Bridge tables mapping alerts to the affected entities. Each shares the same structure:

| Column | Type | Description |
|--------|------|-------------|
| `snapshot_id` | `uuid` | FK to `rt_snapshots.snapshot_id`. |
| `alert_id` | `text` | GTFS alert identifier (part of the PK). |
| `route_id` / `stop_id` / `trip_id` | `text` | FK to the referenced dimension table. |

Rows are only inserted when the referenced entity exists in the dimensions. `ON CONFLICT DO NOTHING` prevents duplication when the feed repeats records inside the same snapshot.

#### `rt_alert_active_periods`

| Column | Type | Description |
|--------|------|-------------|
| `snapshot_id` | `uuid` | FK to `rt_snapshots.snapshot_id`. |
| `alert_id` | `text` | GTFS alert identifier. |
| `period_index` | `integer` | Zero-based index of the active period within the GTFS alert. |
| `active_start_utc` | `timestamptz` | Start timestamp parsed from GTFS. |
| `active_end_utc` | `timestamptz` | End timestamp parsed from GTFS. |

**Notes:** Helps reconstruct complex alert schedules where an alert toggles multiple times in the day.

## Relationships and Data Flow

- GTFS static data is loaded by the `init-db` Docker service during startup. Real-time tables rely on these dimensions for referential integrity.
- Each polling run inserts one row in `rt_snapshots` and multiple fact rows referencing that snapshot.
- Foreign keys from `rt_vehicle_positions`, `rt_rodalies_vehicle_positions`, `rt_trip_delays`, and alert bridge tables point back to the dimension tables, enabling joins without duplicating static metadata.
- `rt_feed_cursors` stores the last processed header timestamp per feed so the poller can skip ingesting unchanged payloads.

## Common Query Patterns

1. **Latest vehicle positions for a route**

   ```sql
   SELECT vp.*
   FROM rt_vehicle_positions vp
   JOIN (
     SELECT entity_id, MAX(snapshot_id) AS snapshot_id
     FROM rt_vehicle_positions
     WHERE route_id = 'RENFE-ROUTE-ID'
     GROUP BY entity_id
   ) latest USING (entity_id, snapshot_id);
   ```

2. **Next arrivals at a stop with current delays**

   ```sql
   SELECT d.trip_id,
          st.stop_sequence,
          (date_trunc('day', s.polled_at_utc) + make_interval(secs => d.scheduled_arrival_seconds)) AS scheduled_arrival,
          d.predicted_arrival_utc,
          d.arrival_delay_seconds
   FROM rt_trip_delays d
   JOIN rt_snapshots s ON s.snapshot_id = d.snapshot_id
   JOIN dim_stop_times st ON st.trip_id = d.trip_id AND st.stop_sequence = d.stop_sequence
   WHERE d.stop_id = 'STOP-ID'
     AND s.polled_at_utc > now() - interval '1 hour'
   ORDER BY d.predicted_arrival_utc NULLS LAST;
   ```

3. **Active alerts impacting a specific route**

   ```sql
   SELECT a.alert_id,
          a.language,
          a.message,
          a.effect,
          a.active_start_utc,
          a.active_end_utc
   FROM rt_alerts a
   JOIN rt_alert_routes ar USING (snapshot_id, alert_id)
   WHERE ar.route_id = 'RENFE-ROUTE-ID'
     AND a.active_end_utc IS DISTINCT FROM a.active_start_utc
   ORDER BY a.created_at_utc DESC;
   ```

4. **Delay history for a trip**

   ```sql
   SELECT s.polled_at_utc,
          d.stop_sequence,
          d.arrival_delay_seconds,
          d.departure_delay_seconds
   FROM rt_trip_delays d
   JOIN rt_snapshots s ON s.snapshot_id = d.snapshot_id
   WHERE d.trip_id = 'TRIP-ID'
   ORDER BY s.polled_at_utc, d.stop_sequence;
   ```

5. **Snapshot health check**

   ```sql
   SELECT polled_at_utc,
          vehicle_feed_timestamp_utc,
          trip_feed_timestamp_utc,
          alert_feed_timestamp_utc
   FROM rt_snapshots
   ORDER BY polled_at_utc DESC
   LIMIT 20;
   ```

These examples cover the most common analytical needs: retrieving the latest vehicle location per train, projecting live arrival times, tracking service alerts, monitoring trip performance, and auditing feed recency.
