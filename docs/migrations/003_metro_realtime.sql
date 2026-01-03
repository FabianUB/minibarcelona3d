-- Migration: 003_metro_realtime
-- Description: Create tables for real-time Metro vehicle positioning via iMetro API
-- Date: 2026-01-01

-- ============================================================================
-- rt_metro_arrivals_current
-- ============================================================================
-- Raw arrival predictions from TMB iMetro API. Each row represents a predicted
-- arrival at a station. Refreshed each poll cycle.

CREATE TABLE IF NOT EXISTS rt_metro_arrivals_current (
    -- Primary key: unique per arrival prediction
    arrival_key TEXT PRIMARY KEY,           -- "L1-326-0-1-1704067200" (line-stop-dir-seq-timestamp)

    -- Snapshot reference (reuses existing rt_snapshots table)
    snapshot_id UUID NOT NULL,

    -- Line and station context
    line_code TEXT NOT NULL,                -- "L1", "L3", etc.
    stop_id TEXT NOT NULL,                  -- TMB stop_id (e.g., "1.326")
    stop_code TEXT,                         -- Stop code for iBus API (e.g., "326")
    direction_id INTEGER NOT NULL,          -- 0 = outbound, 1 = inbound

    -- Arrival prediction from iMetro
    arrival_seconds INTEGER NOT NULL,       -- Seconds until arrival (from iMetro "t-in-s")
    arrival_timestamp_utc TIMESTAMPTZ,      -- Computed: polled_at + arrival_seconds

    -- Vehicle inference
    vehicle_sequence INTEGER,               -- Order of arrivals (1st, 2nd, 3rd train)
    destination_name TEXT,                  -- Headsign/destination from iBus

    -- Metadata
    polled_at_utc TIMESTAMPTZ NOT NULL,     -- When the API was polled
    updated_at TIMESTAMPTZ DEFAULT now(),

    -- Foreign key (commented out if rt_snapshots doesn't exist yet)
    FOREIGN KEY (snapshot_id) REFERENCES rt_snapshots(snapshot_id) ON DELETE CASCADE
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS rt_metro_arrivals_line_idx
    ON rt_metro_arrivals_current (line_code);
CREATE INDEX IF NOT EXISTS rt_metro_arrivals_stop_idx
    ON rt_metro_arrivals_current (stop_id);
CREATE INDEX IF NOT EXISTS rt_metro_arrivals_snapshot_idx
    ON rt_metro_arrivals_current (snapshot_id);
CREATE INDEX IF NOT EXISTS rt_metro_arrivals_direction_idx
    ON rt_metro_arrivals_current (line_code, direction_id);


-- ============================================================================
-- rt_metro_vehicle_current
-- ============================================================================
-- Estimated vehicle positions computed from arrival predictions.
-- Each row represents a single Metro train's estimated position.
-- Refreshed each poll cycle by the poller.

CREATE TABLE IF NOT EXISTS rt_metro_vehicle_current (
    -- Primary key: unique per vehicle
    vehicle_key TEXT PRIMARY KEY,           -- "metro-L1-0-3" (network-line-direction-seq)

    -- Snapshot reference
    snapshot_id UUID NOT NULL,

    -- Line and route context
    line_code TEXT NOT NULL,                -- "L1", "L3", etc.
    route_id TEXT,                          -- TMB route_id (e.g., "1.1.1")
    direction_id INTEGER NOT NULL,          -- 0 = outbound, 1 = inbound

    -- Estimated position (computed from arrival times + line geometry)
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    bearing DOUBLE PRECISION,               -- Direction in degrees (0-360)

    -- Transit context
    previous_stop_id TEXT,
    next_stop_id TEXT,
    previous_stop_name TEXT,
    next_stop_name TEXT,
    status TEXT NOT NULL,                   -- 'IN_TRANSIT_TO', 'ARRIVING', 'STOPPED_AT'

    -- Position estimation metrics
    progress_fraction DOUBLE PRECISION,     -- 0.0-1.0 between stops
    distance_along_line DOUBLE PRECISION,   -- Meters from line start
    estimated_speed_mps DOUBLE PRECISION,   -- Estimated speed in m/s
    line_total_length DOUBLE PRECISION,     -- Total line length in meters

    -- Confidence and source
    source TEXT NOT NULL DEFAULT 'imetro',  -- 'imetro' or 'schedule_fallback'
    confidence TEXT NOT NULL DEFAULT 'medium', -- 'high', 'medium', 'low'
    arrival_seconds_to_next INTEGER,        -- Seconds until next stop (from iMetro)

    -- Timestamps
    estimated_at_utc TIMESTAMPTZ NOT NULL,  -- When position was estimated
    polled_at_utc TIMESTAMPTZ NOT NULL,     -- When arrivals were polled from iMetro
    updated_at TIMESTAMPTZ DEFAULT now(),

    -- Foreign key
    FOREIGN KEY (snapshot_id) REFERENCES rt_snapshots(snapshot_id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS rt_metro_vehicle_line_idx
    ON rt_metro_vehicle_current (line_code);
CREATE INDEX IF NOT EXISTS rt_metro_vehicle_snapshot_idx
    ON rt_metro_vehicle_current (snapshot_id);
CREATE INDEX IF NOT EXISTS rt_metro_vehicle_direction_idx
    ON rt_metro_vehicle_current (line_code, direction_id);


-- ============================================================================
-- rt_metro_vehicle_history
-- ============================================================================
-- Rolling history of vehicle positions for animation interpolation.
-- Defaults to 24 hours of data (configurable via poller).
-- One row per vehicle per snapshot.

CREATE TABLE IF NOT EXISTS rt_metro_vehicle_history (
    -- Composite primary key
    vehicle_key TEXT NOT NULL,
    snapshot_id UUID NOT NULL,

    -- Line context (for filtering)
    line_code TEXT NOT NULL,
    direction_id INTEGER NOT NULL,

    -- Position data
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    bearing DOUBLE PRECISION,

    -- Transit context
    previous_stop_id TEXT,
    next_stop_id TEXT,
    status TEXT,
    progress_fraction DOUBLE PRECISION,

    -- Timestamps
    polled_at_utc TIMESTAMPTZ NOT NULL,

    PRIMARY KEY (vehicle_key, snapshot_id),
    FOREIGN KEY (snapshot_id) REFERENCES rt_snapshots(snapshot_id) ON DELETE CASCADE
);

-- Indexes for efficient timeline queries
CREATE INDEX IF NOT EXISTS rt_metro_vehicle_history_vehicle_idx
    ON rt_metro_vehicle_history (vehicle_key, polled_at_utc DESC);
CREATE INDEX IF NOT EXISTS rt_metro_vehicle_history_line_idx
    ON rt_metro_vehicle_history (line_code, polled_at_utc DESC);


-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE rt_metro_arrivals_current IS
    'Raw arrival predictions from TMB iMetro API, refreshed each poll cycle';

COMMENT ON TABLE rt_metro_vehicle_current IS
    'Estimated Metro vehicle positions computed from arrival predictions';

COMMENT ON TABLE rt_metro_vehicle_history IS
    'Rolling history of Metro vehicle positions for animation interpolation';

COMMENT ON COLUMN rt_metro_vehicle_current.source IS
    'Position data source: imetro (from arrival predictions) or schedule_fallback';

COMMENT ON COLUMN rt_metro_vehicle_current.confidence IS
    'Position confidence: high (<60s to next stop), medium (<300s), low (>=300s)';

COMMENT ON COLUMN rt_metro_vehicle_current.progress_fraction IS
    'Progress between previous and next stop, 0.0 = at previous, 1.0 = at next';
