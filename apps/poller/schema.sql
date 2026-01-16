-- SQLite Schema for Real-Time Transit Tracking
-- Database: data/transit.db
--
-- This schema supports both Rodalies (GTFS-RT) and Metro (iMetro API) tracking.
-- Pollers write every 30 seconds; Go API reads for frontend consumption.

PRAGMA journal_mode = WAL;  -- Better concurrent read performance
PRAGMA foreign_keys = ON;

-- =============================================================================
-- SNAPSHOTS
-- =============================================================================
-- Parent record for each poll iteration

CREATE TABLE IF NOT EXISTS rt_snapshots (
    snapshot_id TEXT PRIMARY KEY,
    polled_at_utc TEXT NOT NULL,
    -- Rodalies-specific feed timestamps (nullable for Metro)
    vehicle_feed_timestamp_utc TEXT,
    trip_feed_timestamp_utc TEXT,
    alert_feed_timestamp_utc TEXT
);

CREATE INDEX IF NOT EXISTS idx_snapshots_polled
    ON rt_snapshots(polled_at_utc DESC);


-- =============================================================================
-- RODALIES TABLES
-- =============================================================================

-- Current position per Rodalies train (single row per vehicle)
CREATE TABLE IF NOT EXISTS rt_rodalies_vehicle_current (
    vehicle_key TEXT PRIMARY KEY,
    snapshot_id TEXT NOT NULL REFERENCES rt_snapshots(snapshot_id) ON DELETE CASCADE,
    vehicle_id TEXT,
    entity_id TEXT,
    vehicle_label TEXT,
    trip_id TEXT,
    route_id TEXT,
    current_stop_id TEXT,
    previous_stop_id TEXT,
    next_stop_id TEXT,
    next_stop_sequence INTEGER,
    status TEXT,
    latitude REAL,
    longitude REAL,
    vehicle_timestamp_utc TEXT,
    polled_at_utc TEXT NOT NULL,
    arrival_delay_seconds INTEGER,
    departure_delay_seconds INTEGER,
    schedule_relationship TEXT,
    predicted_arrival_utc TEXT,
    predicted_departure_utc TEXT,
    trip_update_timestamp_utc TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rodalies_current_route
    ON rt_rodalies_vehicle_current(route_id);
CREATE INDEX IF NOT EXISTS idx_rodalies_current_snapshot
    ON rt_rodalies_vehicle_current(snapshot_id);


-- Rolling history of Rodalies positions (24 hours retention)
CREATE TABLE IF NOT EXISTS rt_rodalies_vehicle_history (
    vehicle_key TEXT NOT NULL,
    snapshot_id TEXT NOT NULL REFERENCES rt_snapshots(snapshot_id) ON DELETE CASCADE,
    vehicle_id TEXT,
    entity_id TEXT,
    vehicle_label TEXT,
    trip_id TEXT,
    route_id TEXT,
    current_stop_id TEXT,
    previous_stop_id TEXT,
    next_stop_id TEXT,
    next_stop_sequence INTEGER,
    status TEXT,
    latitude REAL,
    longitude REAL,
    vehicle_timestamp_utc TEXT,
    polled_at_utc TEXT NOT NULL,
    arrival_delay_seconds INTEGER,
    departure_delay_seconds INTEGER,
    schedule_relationship TEXT,
    predicted_arrival_utc TEXT,
    predicted_departure_utc TEXT,
    trip_update_timestamp_utc TEXT,
    PRIMARY KEY (vehicle_key, snapshot_id)
);

CREATE INDEX IF NOT EXISTS idx_rodalies_history_vehicle
    ON rt_rodalies_vehicle_history(vehicle_key, polled_at_utc DESC);
CREATE INDEX IF NOT EXISTS idx_rodalies_history_route
    ON rt_rodalies_vehicle_history(route_id, polled_at_utc DESC);


-- =============================================================================
-- METRO TABLES
-- =============================================================================

-- Current estimated position per Metro train
CREATE TABLE IF NOT EXISTS rt_metro_vehicle_current (
    vehicle_key TEXT PRIMARY KEY,
    snapshot_id TEXT NOT NULL REFERENCES rt_snapshots(snapshot_id) ON DELETE CASCADE,
    line_code TEXT NOT NULL,
    route_id TEXT,
    direction_id INTEGER NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    bearing REAL,
    previous_stop_id TEXT,
    next_stop_id TEXT,
    previous_stop_name TEXT,
    next_stop_name TEXT,
    status TEXT NOT NULL,
    progress_fraction REAL,
    distance_along_line REAL,
    estimated_speed_mps REAL,
    line_total_length REAL,
    source TEXT NOT NULL DEFAULT 'imetro',
    confidence TEXT NOT NULL DEFAULT 'medium',
    arrival_seconds_to_next INTEGER,
    estimated_at_utc TEXT NOT NULL,
    polled_at_utc TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_metro_current_line
    ON rt_metro_vehicle_current(line_code);
CREATE INDEX IF NOT EXISTS idx_metro_current_snapshot
    ON rt_metro_vehicle_current(snapshot_id);


-- Rolling history of Metro positions (24 hours retention)
CREATE TABLE IF NOT EXISTS rt_metro_vehicle_history (
    vehicle_key TEXT NOT NULL,
    snapshot_id TEXT NOT NULL REFERENCES rt_snapshots(snapshot_id) ON DELETE CASCADE,
    line_code TEXT NOT NULL,
    direction_id INTEGER NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    bearing REAL,
    previous_stop_id TEXT,
    next_stop_id TEXT,
    status TEXT,
    progress_fraction REAL,
    polled_at_utc TEXT NOT NULL,
    PRIMARY KEY (vehicle_key, snapshot_id)
);

CREATE INDEX IF NOT EXISTS idx_metro_history_vehicle
    ON rt_metro_vehicle_history(vehicle_key, polled_at_utc DESC);
CREATE INDEX IF NOT EXISTS idx_metro_history_line
    ON rt_metro_vehicle_history(line_code, polled_at_utc DESC);


-- =============================================================================
-- STATIC DIMENSION TABLES (Optional - for GTFS lookups)
-- =============================================================================

-- Routes dimension (populated from GTFS)
CREATE TABLE IF NOT EXISTS dim_routes (
    route_id TEXT PRIMARY KEY,
    network TEXT,
    route_short_name TEXT,
    route_long_name TEXT,
    route_color TEXT,
    route_text_color TEXT
);

-- Stops dimension (populated from GTFS)
CREATE TABLE IF NOT EXISTS dim_stops (
    stop_id TEXT PRIMARY KEY,
    network TEXT,
    stop_code TEXT,
    stop_name TEXT,
    stop_lat REAL,
    stop_lon REAL
);

CREATE INDEX IF NOT EXISTS idx_stops_network
    ON dim_stops(network);

-- Trips dimension (populated from GTFS)
CREATE TABLE IF NOT EXISTS dim_trips (
    trip_id TEXT PRIMARY KEY,
    network TEXT,
    route_id TEXT,
    service_id TEXT,
    trip_headsign TEXT,
    direction_id INTEGER
);

CREATE INDEX IF NOT EXISTS idx_trips_route
    ON dim_trips(route_id);

-- Stop times dimension (populated from GTFS)
CREATE TABLE IF NOT EXISTS dim_stop_times (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    network TEXT,
    trip_id TEXT,
    stop_id TEXT,
    stop_sequence INTEGER,
    arrival_seconds INTEGER,
    departure_seconds INTEGER
);

CREATE INDEX IF NOT EXISTS idx_stop_times_trip
    ON dim_stop_times(trip_id, stop_sequence);


-- =============================================================================
-- METRICS & BASELINES
-- =============================================================================

-- Baseline statistics for expected vehicle counts by network/hour/day
CREATE TABLE IF NOT EXISTS metrics_baselines (
    network TEXT NOT NULL,
    hour_of_day INTEGER NOT NULL,  -- 0-23
    day_of_week INTEGER NOT NULL,  -- 0=Sun, 1=Mon, ..., 6=Sat
    vehicle_count_mean REAL NOT NULL,
    vehicle_count_stddev REAL NOT NULL,
    sample_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (network, hour_of_day, day_of_week)
);

-- Anomaly events log for tracking deviations from baselines
CREATE TABLE IF NOT EXISTS metrics_anomalies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    network TEXT NOT NULL,
    detected_at TEXT NOT NULL,
    actual_count INTEGER NOT NULL,
    expected_count REAL NOT NULL,
    z_score REAL NOT NULL,
    severity TEXT NOT NULL,  -- 'warning', 'critical'
    resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_anomalies_active
    ON metrics_anomalies(network, resolved_at);
CREATE INDEX IF NOT EXISTS idx_anomalies_detected
    ON metrics_anomalies(detected_at DESC);


-- =============================================================================
-- CLEANUP VIEWS
-- =============================================================================

-- View for stale snapshots (older than 24 hours)
CREATE VIEW IF NOT EXISTS v_stale_snapshots AS
SELECT snapshot_id, polled_at_utc
FROM rt_snapshots
WHERE datetime(polled_at_utc) < datetime('now', '-24 hours');


-- =============================================================================
-- HEALTH HISTORY (for uptime calculation)
-- =============================================================================

-- Records health status every poll cycle (30 seconds) for uptime tracking
CREATE TABLE IF NOT EXISTS metrics_health_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recorded_at TEXT NOT NULL,
    network TEXT NOT NULL,        -- 'rodalies', 'metro', 'bus', 'tram', 'fgc', 'overall'
    health_score INTEGER NOT NULL,
    status TEXT NOT NULL,         -- 'healthy', 'degraded', 'unhealthy', 'unknown'
    vehicle_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_health_history_lookup
    ON metrics_health_history(network, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_health_history_cleanup
    ON metrics_health_history(recorded_at);
