package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"github.com/you/myapp/apps/api/models"
)

// MetricsRepository handles health and metrics queries
type MetricsRepository struct {
	db *sql.DB
}

// NewMetricsRepository creates a new MetricsRepository
func NewMetricsRepository(db *sql.DB) *MetricsRepository {
	return &MetricsRepository{db: db}
}

// GetDataFreshness returns data freshness for all networks
func (r *MetricsRepository) GetDataFreshness(ctx context.Context) ([]models.DataFreshness, error) {
	freshness := make([]models.DataFreshness, 0, 5)
	now := time.Now().UTC()

	// Rodalies freshness
	rodaliesFreshness, err := r.getRodaliesFreshness(ctx, now)
	if err == nil {
		freshness = append(freshness, rodaliesFreshness)
	}

	// Metro freshness
	metroFreshness, err := r.getMetroFreshness(ctx, now)
	if err == nil {
		freshness = append(freshness, metroFreshness)
	}

	// Schedule-based networks (Bus, Tram, FGC) - these are calculated, not polled
	// So they're always "fresh" if the schedule data exists
	scheduleFreshness := r.getScheduleFreshness(ctx, now)
	freshness = append(freshness, scheduleFreshness...)

	return freshness, nil
}

// getRodaliesFreshness gets freshness for Rodalies network
func (r *MetricsRepository) getRodaliesFreshness(ctx context.Context, now time.Time) (models.DataFreshness, error) {
	// Only count vehicles updated in the last 10 minutes (same filter as trains API)
	query := `
		SELECT
			MAX(polled_at_utc) as last_polled,
			COUNT(*) as vehicle_count
		FROM rt_rodalies_vehicle_current
		WHERE datetime(updated_at) > datetime('now', '-10 minutes')
	`

	var lastPolled sql.NullString
	var vehicleCount int

	err := r.db.QueryRowContext(ctx, query).Scan(&lastPolled, &vehicleCount)
	if err != nil {
		return models.DataFreshness{
			Network: models.NetworkRodalies,
			Status:  models.FreshnessUnavailable,
		}, err
	}

	freshness := models.DataFreshness{
		Network:      models.NetworkRodalies,
		VehicleCount: vehicleCount,
	}

	if lastPolled.Valid && lastPolled.String != "" {
		t, err := time.Parse(time.RFC3339, lastPolled.String)
		if err == nil {
			freshness.LastPolledAt = &t
			freshness.AgeSeconds = int(now.Sub(t).Seconds())
			freshness.Status = models.CalculateFreshnessStatus(freshness.AgeSeconds)
		} else {
			freshness.Status = models.FreshnessUnavailable
		}
	} else {
		freshness.Status = models.FreshnessUnavailable
		freshness.AgeSeconds = -1
	}

	return freshness, nil
}

// getMetroFreshness gets freshness for Metro network
func (r *MetricsRepository) getMetroFreshness(ctx context.Context, now time.Time) (models.DataFreshness, error) {
	query := `
		SELECT
			MAX(polled_at_utc) as last_polled,
			COUNT(*) as vehicle_count
		FROM rt_metro_vehicle_current
	`

	var lastPolled sql.NullString
	var vehicleCount int

	err := r.db.QueryRowContext(ctx, query).Scan(&lastPolled, &vehicleCount)
	if err != nil {
		return models.DataFreshness{
			Network: models.NetworkMetro,
			Status:  models.FreshnessUnavailable,
		}, err
	}

	freshness := models.DataFreshness{
		Network:      models.NetworkMetro,
		VehicleCount: vehicleCount,
	}

	if lastPolled.Valid && lastPolled.String != "" {
		t, err := time.Parse(time.RFC3339, lastPolled.String)
		if err == nil {
			freshness.LastPolledAt = &t
			freshness.AgeSeconds = int(now.Sub(t).Seconds())
			freshness.Status = models.CalculateFreshnessStatus(freshness.AgeSeconds)
		} else {
			freshness.Status = models.FreshnessUnavailable
		}
	} else {
		freshness.Status = models.FreshnessUnavailable
		freshness.AgeSeconds = -1
	}

	return freshness, nil
}

// getScheduleFreshness returns freshness for schedule-based networks
func (r *MetricsRepository) getScheduleFreshness(ctx context.Context, now time.Time) []models.DataFreshness {
	// Schedule-based networks are always "fresh" since they're calculated from static schedules
	// Get current vehicle counts from pre_schedule_positions table
	networks := []models.NetworkType{models.NetworkBus, models.NetworkTram, models.NetworkFGC}
	result := make([]models.DataFreshness, 0, len(networks))

	// Get vehicle counts for each network
	counts := r.getScheduleVehicleCounts(ctx, now)

	for _, network := range networks {
		count := -1
		if c, ok := counts[network]; ok {
			count = c
		}
		result = append(result, models.DataFreshness{
			Network:      network,
			AgeSeconds:   0,
			Status:       models.FreshnessFresh,
			VehicleCount: count,
		})
	}

	return result
}

// getScheduleVehicleCounts returns vehicle counts from pre-calculated schedule positions
func (r *MetricsRepository) getScheduleVehicleCounts(ctx context.Context, now time.Time) map[models.NetworkType]int {
	counts := make(map[models.NetworkType]int)

	// Load Barcelona timezone
	barcelonaTZ, err := time.LoadLocation("Europe/Madrid")
	if err != nil {
		return counts
	}

	// Get current time in Barcelona timezone
	bcnNow := now.In(barcelonaTZ)

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

	// Query for positions JSON per network
	query := `
		SELECT network, positions_json
		FROM pre_schedule_positions
		WHERE day_type = ? AND time_slot = ?
	`

	rows, err := r.db.QueryContext(ctx, query, dayType, timeSlot)
	if err != nil {
		return counts
	}
	defer rows.Close()

	// Map network names to NetworkType
	networkMap := map[string]models.NetworkType{
		"bus":  models.NetworkBus,
		"tram": models.NetworkTram,
		"fgc":  models.NetworkFGC,
	}

	for rows.Next() {
		var network string
		var positionsJSON string
		if err := rows.Scan(&network, &positionsJSON); err != nil {
			continue
		}

		// Parse JSON array to count vehicles
		var positions []map[string]interface{}
		if err := json.Unmarshal([]byte(positionsJSON), &positions); err != nil {
			continue
		}

		if netType, ok := networkMap[network]; ok {
			counts[netType] = len(positions)
		}
	}

	return counts
}

// GetNetworkVehicleCounts returns current vehicle counts per network
func (r *MetricsRepository) GetNetworkVehicleCounts(ctx context.Context) (map[models.NetworkType]int, error) {
	counts := make(map[models.NetworkType]int)

	// Rodalies count (only vehicles updated in last 10 minutes)
	var rodaliesCount int
	err := r.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM rt_rodalies_vehicle_current WHERE datetime(updated_at) > datetime('now', '-10 minutes')").Scan(&rodaliesCount)
	if err == nil {
		counts[models.NetworkRodalies] = rodaliesCount
	}

	// Metro count (only vehicles updated in last 10 minutes)
	var metroCount int
	err = r.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM rt_metro_vehicle_current WHERE datetime(updated_at) > datetime('now', '-10 minutes')").Scan(&metroCount)
	if err == nil {
		counts[models.NetworkMetro] = metroCount
	}

	return counts, nil
}

// GetLatestSnapshot returns the most recent snapshot info
func (r *MetricsRepository) GetLatestSnapshot(ctx context.Context) (*time.Time, error) {
	query := `SELECT MAX(polled_at_utc) FROM rt_snapshots`

	var polledAt sql.NullString
	err := r.db.QueryRowContext(ctx, query).Scan(&polledAt)
	if err != nil {
		return nil, err
	}

	if !polledAt.Valid || polledAt.String == "" {
		return nil, nil
	}

	t, err := time.Parse(time.RFC3339, polledAt.String)
	if err != nil {
		return nil, err
	}

	return &t, nil
}

// GetRodaliesDataQuality returns data quality metrics for Rodalies
func (r *MetricsRepository) GetRodaliesDataQuality(ctx context.Context) (total int, withGPS int, err error) {
	// Only count vehicles updated in last 10 minutes (same filter as trains API)
	query := `
		SELECT
			COUNT(*) as total,
			COUNT(CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN 1 END) as with_gps
		FROM rt_rodalies_vehicle_current
		WHERE datetime(updated_at) > datetime('now', '-10 minutes')
	`

	err = r.db.QueryRowContext(ctx, query).Scan(&total, &withGPS)
	return
}

// GetMetroDataQuality returns data quality metrics for Metro
func (r *MetricsRepository) GetMetroDataQuality(ctx context.Context) (total int, highConfidence int, err error) {
	// Only count vehicles updated in last 10 minutes
	query := `
		SELECT
			COUNT(*) as total,
			COUNT(CASE WHEN confidence IN ('high', 'medium') THEN 1 END) as high_confidence
		FROM rt_metro_vehicle_current
		WHERE datetime(updated_at) > datetime('now', '-10 minutes')
	`

	err = r.db.QueryRowContext(ctx, query).Scan(&total, &highConfidence)
	return
}

// =============================================================================
// BASELINE METHODS
// =============================================================================

// GetBaseline returns the baseline for a network at a specific hour and day of week
func (r *MetricsRepository) GetBaseline(ctx context.Context, network models.NetworkType, hour, dayOfWeek int) (*models.NetworkBaseline, error) {
	query := `
		SELECT network, hour_of_day, day_of_week, vehicle_count_mean, vehicle_count_stddev, sample_count
		FROM metrics_baselines
		WHERE network = ? AND hour_of_day = ? AND day_of_week = ?
	`

	var baseline models.NetworkBaseline
	err := r.db.QueryRowContext(ctx, query, string(network), hour, dayOfWeek).Scan(
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

// GetAllBaselines returns all baselines for a network
func (r *MetricsRepository) GetAllBaselines(ctx context.Context, network models.NetworkType) ([]models.NetworkBaseline, error) {
	query := `
		SELECT network, hour_of_day, day_of_week, vehicle_count_mean, vehicle_count_stddev, sample_count
		FROM metrics_baselines
		WHERE network = ?
		ORDER BY day_of_week, hour_of_day
	`

	rows, err := r.db.QueryContext(ctx, query, string(network))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var baselines []models.NetworkBaseline
	for rows.Next() {
		var b models.NetworkBaseline
		if err := rows.Scan(&b.Network, &b.HourOfDay, &b.DayOfWeek, &b.VehicleCountMean, &b.VehicleCountStdDev, &b.SampleCount); err != nil {
			continue
		}
		baselines = append(baselines, b)
	}

	return baselines, nil
}

// SaveBaseline upserts a baseline record
func (r *MetricsRepository) SaveBaseline(ctx context.Context, baseline models.NetworkBaseline) error {
	query := `
		INSERT INTO metrics_baselines (network, hour_of_day, day_of_week, vehicle_count_mean, vehicle_count_stddev, sample_count, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (network, hour_of_day, day_of_week) DO UPDATE SET
			vehicle_count_mean = excluded.vehicle_count_mean,
			vehicle_count_stddev = excluded.vehicle_count_stddev,
			sample_count = excluded.sample_count,
			updated_at = excluded.updated_at
	`

	_, err := r.db.ExecContext(ctx, query,
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

// =============================================================================
// ANOMALY METHODS
// =============================================================================

// GetActiveAnomalies returns all unresolved anomalies
func (r *MetricsRepository) GetActiveAnomalies(ctx context.Context) ([]models.AnomalyEvent, error) {
	query := `
		SELECT id, network, detected_at, actual_count, expected_count, z_score, severity, resolved_at
		FROM metrics_anomalies
		WHERE resolved_at IS NULL
		ORDER BY detected_at DESC
	`

	rows, err := r.db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var anomalies []models.AnomalyEvent
	for rows.Next() {
		var a models.AnomalyEvent
		var detectedAt string
		var resolvedAt sql.NullString
		var actualCount int
		var expectedCount, zScore float64

		if err := rows.Scan(&a.ID, &a.Network, &detectedAt, &actualCount, &expectedCount, &zScore, &a.Severity, &resolvedAt); err != nil {
			continue
		}

		if t, err := time.Parse(time.RFC3339, detectedAt); err == nil {
			a.DetectedAt = t
		}
		if resolvedAt.Valid {
			if t, err := time.Parse(time.RFC3339, resolvedAt.String); err == nil {
				a.ResolvedAt = &t
			}
		}

		a.ActualValue = &[]float64{float64(actualCount)}[0]
		a.ExpectedValue = &expectedCount
		a.ZScore = &zScore
		a.AnomalyType = "low_vehicle_count"
		a.IsActive = true
		a.Description = "Vehicle count deviation from baseline"

		anomalies = append(anomalies, a)
	}

	return anomalies, nil
}

// GetActiveAnomalyCount returns the count of active anomalies for a network
func (r *MetricsRepository) GetActiveAnomalyCount(ctx context.Context, network models.NetworkType) (int, error) {
	query := `
		SELECT COUNT(*)
		FROM metrics_anomalies
		WHERE network = ? AND resolved_at IS NULL
	`

	var count int
	err := r.db.QueryRowContext(ctx, query, string(network)).Scan(&count)
	return count, err
}

// RecordAnomaly logs a new anomaly event
func (r *MetricsRepository) RecordAnomaly(ctx context.Context, network models.NetworkType, actualCount int, expectedCount, zScore float64, severity string) error {
	// Check if there's already an active anomaly for this network
	existing, _ := r.GetActiveAnomalyCount(ctx, network)
	if existing > 0 {
		// Update existing anomaly instead of creating duplicate
		return nil
	}

	query := `
		INSERT INTO metrics_anomalies (network, detected_at, actual_count, expected_count, z_score, severity)
		VALUES (?, ?, ?, ?, ?, ?)
	`

	_, err := r.db.ExecContext(ctx, query,
		string(network),
		time.Now().UTC().Format(time.RFC3339),
		actualCount,
		expectedCount,
		zScore,
		severity,
	)
	return err
}

// ResolveAnomaly marks all active anomalies for a network as resolved
func (r *MetricsRepository) ResolveAnomaly(ctx context.Context, network models.NetworkType) error {
	query := `
		UPDATE metrics_anomalies
		SET resolved_at = ?
		WHERE network = ? AND resolved_at IS NULL
	`

	_, err := r.db.ExecContext(ctx, query, time.Now().UTC().Format(time.RFC3339), string(network))
	return err
}
