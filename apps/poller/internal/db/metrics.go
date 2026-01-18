package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"github.com/mini-rodalies-3d/poller/internal/metrics"
)

// GetBaseline retrieves a baseline for a specific network, hour, and day
func (db *DB) GetBaseline(ctx context.Context, network metrics.NetworkType, hour, dayOfWeek int) (*metrics.NetworkBaseline, error) {
	query := `
		SELECT network, hour_of_day, day_of_week, vehicle_count_mean, vehicle_count_stddev, sample_count
		FROM metrics_baselines
		WHERE network = ? AND hour_of_day = ? AND day_of_week = ?
	`

	var baseline metrics.NetworkBaseline
	err := db.conn.QueryRowContext(ctx, query, string(network), hour, dayOfWeek).Scan(
		&baseline.Network,
		&baseline.HourOfDay,
		&baseline.DayOfWeek,
		&baseline.VehicleCountMean,
		&baseline.VehicleCountStdDev,
		&baseline.SampleCount,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &baseline, nil
}

// SaveBaseline upserts a baseline record
func (db *DB) SaveBaseline(ctx context.Context, baseline metrics.NetworkBaseline) error {
	db.LockWrite()
	defer db.UnlockWrite()

	query := `
		INSERT INTO metrics_baselines (network, hour_of_day, day_of_week, vehicle_count_mean, vehicle_count_stddev, sample_count, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (network, hour_of_day, day_of_week) DO UPDATE SET
			vehicle_count_mean = excluded.vehicle_count_mean,
			vehicle_count_stddev = excluded.vehicle_count_stddev,
			sample_count = excluded.sample_count,
			updated_at = excluded.updated_at
	`

	_, err := db.conn.ExecContext(ctx, query,
		string(baseline.Network),
		baseline.HourOfDay,
		baseline.DayOfWeek,
		baseline.VehicleCountMean,
		baseline.VehicleCountStdDev,
		baseline.SampleCount,
		time.Now().UTC().Format(time.RFC3339),
	)
	return err
}

// GetVehicleCount returns current vehicle count for a network.
// For real-time networks (Rodalies, Metro): counts from current tables.
// For schedule-based networks (Bus, Tram, FGC): counts from pre-calculated positions.
func (db *DB) GetVehicleCount(ctx context.Context, network metrics.NetworkType) (int, error) {
	switch network {
	case metrics.NetworkRodalies:
		return db.getRealTimeVehicleCount(ctx, "rt_rodalies_vehicle_current")
	case metrics.NetworkMetro:
		return db.getRealTimeVehicleCount(ctx, "rt_metro_vehicle_current")
	case metrics.NetworkBus, metrics.NetworkTram, metrics.NetworkFGC:
		return db.getScheduleVehicleCount(ctx, network)
	default:
		return 0, nil
	}
}

// getRealTimeVehicleCount counts vehicles from real-time tables
func (db *DB) getRealTimeVehicleCount(ctx context.Context, table string) (int, error) {
	query := `SELECT COUNT(*) FROM ` + table + ` WHERE datetime(updated_at) > datetime('now', '-10 minutes')`
	var count int
	err := db.conn.QueryRowContext(ctx, query).Scan(&count)
	if err != nil {
		return 0, err
	}
	return count, nil
}

// getScheduleVehicleCount counts vehicles from pre-calculated schedule positions
func (db *DB) getScheduleVehicleCount(ctx context.Context, network metrics.NetworkType) (int, error) {
	// Load Barcelona timezone
	barcelonaTZ, err := time.LoadLocation("Europe/Madrid")
	if err != nil {
		return 0, err
	}

	// Get current time in Barcelona timezone
	bcnNow := time.Now().In(barcelonaTZ)

	// Calculate day type
	dayType := "weekday"
	switch bcnNow.Weekday() {
	case time.Saturday:
		dayType = "saturday"
	case time.Sunday:
		dayType = "sunday"
	}

	// Calculate time slot (30-second intervals)
	secondsSinceMidnight := bcnNow.Hour()*3600 + bcnNow.Minute()*60 + bcnNow.Second()
	timeSlot := secondsSinceMidnight / 30

	// Map network type to database network names
	// Note: tram is stored as tram_tbs and tram_tbx in the database
	var networkNames []string
	switch network {
	case metrics.NetworkBus:
		networkNames = []string{"bus"}
	case metrics.NetworkTram:
		networkNames = []string{"tram_tbs", "tram_tbx"}
	case metrics.NetworkFGC:
		networkNames = []string{"fgc"}
	default:
		return 0, nil
	}

	totalCount := 0
	for _, netName := range networkNames {
		query := `
			SELECT positions_json
			FROM pre_schedule_positions
			WHERE network = ? AND day_type = ? AND time_slot = ?
		`
		var positionsJSON string
		err := db.conn.QueryRowContext(ctx, query, netName, dayType, timeSlot).Scan(&positionsJSON)
		if err == sql.ErrNoRows {
			continue
		}
		if err != nil {
			continue
		}

		// Parse JSON array to count vehicles
		var positions []map[string]interface{}
		if err := json.Unmarshal([]byte(positionsJSON), &positions); err != nil {
			continue
		}
		totalCount += len(positions)
	}

	return totalCount, nil
}

// RecordHealthStatus records a health status snapshot for uptime tracking
func (db *DB) RecordHealthStatus(ctx context.Context, status metrics.HealthStatus) error {
	db.LockWrite()
	defer db.UnlockWrite()

	query := `
		INSERT INTO metrics_health_history (recorded_at, network, health_score, status, vehicle_count)
		VALUES (?, ?, ?, ?, ?)
	`
	_, err := db.conn.ExecContext(ctx, query,
		time.Now().UTC().Format(time.RFC3339),
		status.Network,
		status.HealthScore,
		status.Status,
		status.VehicleCount,
	)
	return err
}

// CleanupHealthHistory removes health history older than 48 hours
func (db *DB) CleanupHealthHistory(ctx context.Context) error {
	db.LockWrite()
	defer db.UnlockWrite()

	query := `DELETE FROM metrics_health_history WHERE datetime(recorded_at) < datetime('now', '-48 hours')`
	_, err := db.conn.ExecContext(ctx, query)
	return err
}
