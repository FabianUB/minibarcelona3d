package db

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"time"

	_ "modernc.org/sqlite"
)

// DB wraps a SQLite database connection
type DB struct {
	conn *sql.DB
}

// Connect opens a SQLite database with WAL mode enabled
func Connect(dbPath string) (*DB, error) {
	// Open with WAL mode and foreign keys enabled
	dsn := dbPath + "?_journal=WAL&_fk=1&_busy_timeout=5000"
	conn, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Configure connection pool
	// SQLite only supports one writer at a time, so we limit to 1 connection
	// to prevent "cannot start a transaction within a transaction" errors
	conn.SetMaxOpenConns(1)
	conn.SetMaxIdleConns(1)
	conn.SetConnMaxLifetime(time.Hour)

	// Test connection
	if err := conn.Ping(); err != nil {
		conn.Close()
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	// Performance tuning PRAGMAs
	pragmas := []string{
		"PRAGMA synchronous = NORMAL",  // Faster writes, still safe with WAL
		"PRAGMA cache_size = 10000",    // ~40MB cache for faster reads
		"PRAGMA temp_store = MEMORY",   // Use RAM for temp tables
		"PRAGMA mmap_size = 268435456", // 256MB memory-mapped I/O
	}
	for _, pragma := range pragmas {
		if _, err := conn.Exec(pragma); err != nil {
			log.Printf("Warning: failed to set %s: %v", pragma, err)
		}
	}

	log.Printf("Connected to SQLite database: %s", dbPath)
	return &DB{conn: conn}, nil
}

// Close closes the database connection
func (db *DB) Close() error {
	return db.conn.Close()
}

// Conn returns the underlying database connection for use by writers
func (db *DB) Conn() *sql.DB {
	return db.conn
}

// EnsureSchema creates tables if they don't exist
func (db *DB) EnsureSchema(ctx context.Context) error {
	schema := `
	-- Snapshots table
	CREATE TABLE IF NOT EXISTS rt_snapshots (
		snapshot_id TEXT PRIMARY KEY,
		polled_at_utc TEXT NOT NULL,
		vehicle_feed_timestamp_utc TEXT,
		trip_feed_timestamp_utc TEXT,
		alert_feed_timestamp_utc TEXT
	);
	CREATE INDEX IF NOT EXISTS idx_snapshots_polled ON rt_snapshots(polled_at_utc DESC);

	-- Rodalies current positions
	CREATE TABLE IF NOT EXISTS rt_rodalies_vehicle_current (
		vehicle_key TEXT PRIMARY KEY,
		snapshot_id TEXT NOT NULL,
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
	CREATE INDEX IF NOT EXISTS idx_rodalies_current_route ON rt_rodalies_vehicle_current(route_id);
	CREATE INDEX IF NOT EXISTS idx_rodalies_current_snapshot ON rt_rodalies_vehicle_current(snapshot_id);
	CREATE INDEX IF NOT EXISTS idx_rodalies_current_updated ON rt_rodalies_vehicle_current(updated_at DESC);

	-- Rodalies history
	CREATE TABLE IF NOT EXISTS rt_rodalies_vehicle_history (
		vehicle_key TEXT NOT NULL,
		snapshot_id TEXT NOT NULL,
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
	CREATE INDEX IF NOT EXISTS idx_rodalies_history_vehicle ON rt_rodalies_vehicle_history(vehicle_key, polled_at_utc DESC);

	-- Metro current positions
	CREATE TABLE IF NOT EXISTS rt_metro_vehicle_current (
		vehicle_key TEXT PRIMARY KEY,
		snapshot_id TEXT NOT NULL,
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
	CREATE INDEX IF NOT EXISTS idx_metro_current_line ON rt_metro_vehicle_current(line_code);
	CREATE INDEX IF NOT EXISTS idx_metro_current_snapshot ON rt_metro_vehicle_current(snapshot_id);
	CREATE INDEX IF NOT EXISTS idx_metro_current_updated ON rt_metro_vehicle_current(updated_at DESC);

	-- Metro history
	CREATE TABLE IF NOT EXISTS rt_metro_vehicle_history (
		vehicle_key TEXT NOT NULL,
		snapshot_id TEXT NOT NULL,
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
	CREATE INDEX IF NOT EXISTS idx_metro_history_vehicle ON rt_metro_vehicle_history(vehicle_key, polled_at_utc DESC);
	`

	_, err := db.conn.ExecContext(ctx, schema)
	if err != nil {
		return fmt.Errorf("failed to create schema: %w", err)
	}

	log.Println("Database schema ensured")
	return nil
}
