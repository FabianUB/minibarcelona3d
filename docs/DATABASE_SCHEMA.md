# Real-Time Vehicle Tables

> **Note**: This document describes the logical database schema. The actual implementation uses **SQLite**. Type names like `double precision` and `timestamptz` indicate intended data formats and are stored as REAL and TEXT respectively in SQLite.

This document outlines the tables designed to power the application's real-time views of Rodalies trains. Each section includes column-by-column details plus guidance on how the app should use the data. The source `rt_vehicle_positions` table continues to store every vehicle feed row; the tables below are Rodalies-only projections maintained by the poller.

## `rt_rodalies_vehicle_current`

Single-row snapshot per active vehicle, refreshed each poll. Ideal for live maps, vehicle detail panels, or route dashboards.

| Column | Type | Description |
| --- | --- | --- |
| `vehicle_key` | `text` | Stable key used for upserts. Equals `vehicle_id` when provided; falls back to `entity:{entity_id}` when the feed omits an ID. |
| `snapshot_id` | `uuid` | Foreign key into `rt_snapshots`; identifies the poll iteration that produced this row. |
| `vehicle_id` | `text` | Provider vehicle identifier when available. Nullable in feeds that omit it; use `vehicle_key` when joining. |
| `entity_id` | `text` | Identifier of the GTFS-RT entity the feed sent. Distinct per feed message. |
| `vehicle_label` | `text` | Marketing-facing label shown to riders (e.g., train number). Only rows whose label begins with `R` are stored. |
| `trip_id` | `text` | Static GTFS trip identifier, nullable if the feed cannot be mapped. |
| `route_id` | `text` | Static GTFS route identifier inferred from the trip. |
| `current_stop_id` | `text` | Stop where the vehicle is currently recorded. Null when between stops or stop is unknown. |
| `previous_stop_id` | `text` | Stop immediately before `current_stop_id`, inferred from static stop times. |
| `next_stop_id` | `text` | Next scheduled stop per static GTFS or fallback CSV. |
| `next_stop_sequence` | `integer` | Sequence number of `next_stop_id` in the trip pattern. |
| `status` | `text` | GTFS-RT `VehicleStopStatus` (e.g., `IN_TRANSIT_TO`, `STOPPED_AT`). |
| `latitude` | `double precision` | Last known latitude from the feed. |
| `longitude` | `double precision` | Last known longitude from the feed. |
| `vehicle_timestamp_utc` | `timestamptz` | Timestamp carried in the feed for this vehicle, if provided. |
| `polled_at_utc` | `timestamptz` | Server-side time when the poller ingested the feed. Useful to detect stale rows after feed outages. |
| `arrival_delay_seconds` | `integer` | Latest arrival delay at the current stop (seconds late, negative if early) sourced from the trip updates feed. |
| `departure_delay_seconds` | `integer` | Latest departure delay for the current stop. |
| `schedule_relationship` | `text` | GTFS schedule relationship for the stop (e.g., `SCHEDULED`, `SKIPPED`). |
| `predicted_arrival_utc` | `timestamptz` | Predicted arrival timestamp from the trip update, when provided. |
| `predicted_departure_utc` | `timestamptz` | Predicted departure timestamp from the trip update, when provided. |
| `trip_update_timestamp_utc` | `timestamptz` | Header timestamp of the trip-updates feed that supplied the delay snapshot. |
| `updated_at` | `timestamptz` | Automatic timestamp written on each upsert for auditing / debugging. |

**Indexes**
- `rt_rodalies_vehicle_current_vehicle_id_idx` ensures unique rows per `vehicle_id` when present.
- `rt_rodalies_vehicle_current_route_idx` accelerates route-level lookups (e.g., show all trains on route C5).

**Usage Tips**
- Query this table for real-time views. Filter by `vehicle_id`, `route_id`, or geographic bounding boxes.
- Use `snapshot_id` to join against other per-snapshot tables (trip delays, alerts) if you need consistent reads.
- Detect stale data by comparing `polled_at_utc` to `now()`; if the delta exceeds the poll interval, the feed may be delayed.
- Every row represents a Rodalies train (vehicle labels start with `R`), so downstream code can rely on that filter already being applied.

## `rt_rodalies_vehicle_history`

Rolling history that mirrors the current table but retains one row per vehicle per snapshot. Defaults to 24 hours of data (configurable via `--vehicle-history-hours`).

| Column | Type | Description |
| --- | --- | --- |
| `vehicle_key` | `text` | Same derivation as in `rt_rodalies_vehicle_current`; included in the primary key. |
| `snapshot_id` | `uuid` | Poll iteration; part of the primary key and foreign key to `rt_snapshots`. |
| `vehicle_id` | `text` | Vehicle identifier when supplied. |
| `entity_id` | `text` | Raw GTFS-RT entity ID used in the feed. |
| `vehicle_label` | `text` | Rider-facing label for the vehicle. Only labels beginning with `R` are recorded. |
| `trip_id` | `text` | Linked static GTFS trip identifier. |
| `route_id` | `text` | Route assigned to the trip. |
| `current_stop_id` | `text` | Stop ID reported in the feed. |
| `previous_stop_id` | `text` | Previous stop by static schedule inference. |
| `next_stop_id` | `text` | Next scheduled stop. |
| `next_stop_sequence` | `integer` | Sequence number for the next stop. |
| `status` | `text` | GTFS-RT vehicle status at this snapshot. |
| `latitude` | `double precision` | Latitude captured in the snapshot. |
| `longitude` | `double precision` | Longitude captured in the snapshot. |
| `vehicle_timestamp_utc` | `timestamptz` | Feed-side timestamp for the vehicle. |
| `polled_at_utc` | `timestamptz` | Server-side ingestion timestamp; use it to order rows chronologically. |
| `arrival_delay_seconds` | `integer` | Arrival delay at the referenced stop when the snapshot was taken. |
| `departure_delay_seconds` | `integer` | Departure delay at the referenced stop when the snapshot was taken. |
| `schedule_relationship` | `text` | Schedule relationship reported by the trip updates feed. |
| `predicted_arrival_utc` | `timestamptz` | Predicted arrival timestamp, if present. |
| `predicted_departure_utc` | `timestamptz` | Predicted departure timestamp, if present. |
| `trip_update_timestamp_utc` | `timestamptz` | Trip-updates header timestamp associated with the delay values. |

**Indexes**
- `rt_rodalies_vehicle_history_vehicle_idx` supports ordering by vehicle and time (timeline views).
- `rt_rodalies_vehicle_history_route_idx` supports route-specific timelines.

**Usage Tips**
- Build short-term playback or sparkline-style charts by ordering rows with `ORDER BY vehicle_key, polled_at_utc`.
- Pruned automatically when the poller deletes rows older than the configured retention window; adjust via CLI/env.
- Combine with `rt_snapshots.polled_at_utc` or feed timestamps to compare server vs. feed latency.

## `rt_rodalies_vehicle_positions`

Raw per-snapshot ingest of the vehicle feed. Unlike the history table, it does not aggregate per vehicle and retains the original GTFS entity IDs only.

| Column | Type | Description |
| --- | --- | --- |
| `snapshot_id` | `uuid` | Foreign key to `rt_snapshots`. |
| `entity_id` | `text` | Primary key component; unique per GTFS-RT entity within the snapshot. |
| `vehicle_id` | `text` | Provider vehicle identifier, if present. |
| `vehicle_label` | `text` | Label displayed to passengers; ingestion keeps only rows whose label begins with `R`. |
| `trip_id` | `text` | Linked GTFS trip identifier. |
| `route_id` | `text` | Derived GTFS route. |
| `current_stop_id` | `text` | Stop provided in the feed. |
| `previous_stop_id` | `text` | Prior stop inferred from static stop times. |
| `next_stop_id` | `text` | Upcoming stop inferred from static data. |
| `next_stop_sequence` | `integer` | Stop sequence of `next_stop_id`. |
| `status` | `text` | GTFS-RT vehicle status. |
| `latitude` | `double precision` | Latitude as sent by the feed. |
| `longitude` | `double precision` | Longitude as sent by the feed. |
| `arrival_delay_seconds` | `integer` | Arrival delay at the current stop (seconds). |
| `departure_delay_seconds` | `integer` | Departure delay at the current stop (seconds). |
| `schedule_relationship` | `text` | Schedule relationship reported by the trip updates feed. |
| `predicted_arrival_utc` | `timestamptz` | Predicted arrival timestamp, if provided. |
| `predicted_departure_utc` | `timestamptz` | Predicted departure timestamp, if provided. |
| `trip_update_timestamp_utc` | `timestamptz` | Trip-updates header timestamp used for these delay values. |

**Indexes**
- `rt_rodalies_vehicle_positions_vehicle_idx` accelerates querying all rows for a given `vehicle_id` ordered by newest snapshot first.

**Usage Tips**
- This table keeps a full lineage of the raw feed data. Use it when debugging ingestion, replaying the exact GTFS-RT payload, or regenerating downstream tables.
- Retention is managed separately (via database archiving scripts); plan for periodic archiving or compression if storage is a concern.

## Operational Notes

- Both `rt_rodalies_vehicle_current` and `rt_rodalies_vehicle_history` are populated during every ingestion cycle immediately after rows land in `rt_vehicle_positions`; only rows whose label begins with `R` are copied into the Rodalies tables. Delay metrics are populated from the matching trip-update feed snapshot in the same transaction.
- The poller deletes history/current rows older than the configured retention window (`--vehicle-history-hours`, default 24). To increase or decrease history, pass the CLI flag or set `VEHICLE_HISTORY_HOURS`.
- When the feed omits `vehicle_id`, use `vehicle_key` for joins and lookups. This guarantees a unique identifier even for anonymous entities.
- For real-time API endpoints, prefer reading from `rt_rodalies_vehicle_current`. Fall back to `rt_rodalies_vehicle_history` for “time travel” views or to render short-term charts. Avoid hitting `rt_rodalies_vehicle_positions` directly in latency-sensitive paths unless you need the raw feed verbatim.
