package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"math"
	"regexp"
	"strings"
	"time"

	"github.com/you/myapp/apps/api/models"
)

// rodaliesLineCodeRe extracts Rodalies line codes (R1, R2N, RL4, etc.) from GTFS route IDs.
var rodaliesLineCodeRe = regexp.MustCompile(`(R\d+[NS]?|RG\d|RL\d|RT\d)`)

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
	// Note: Compare updated_at directly (without datetime() wrapper) to allow index usage.
	query := `
		SELECT
			MAX(polled_at_utc) as last_polled,
			COUNT(*) as vehicle_count
		FROM rt_rodalies_vehicle_current
		WHERE updated_at > datetime('now', '-10 minutes')
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
	// Note: tram is stored as tram_tbs and tram_tbx in the database
	networkMap := map[string]models.NetworkType{
		"bus":      models.NetworkBus,
		"tram_tbs": models.NetworkTram,
		"tram_tbx": models.NetworkTram,
		"fgc":      models.NetworkFGC,
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
			// Accumulate counts for networks that have multiple DB entries (like tram)
			counts[netType] += len(positions)
		}
	}

	return counts
}

// GetNetworkVehicleCounts returns current vehicle counts per network
func (r *MetricsRepository) GetNetworkVehicleCounts(ctx context.Context) (map[models.NetworkType]int, error) {
	counts := make(map[models.NetworkType]int)

	// Rodalies count (only vehicles updated in last 10 minutes)
	var rodaliesCount int
	err := r.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM rt_rodalies_vehicle_current WHERE updated_at > datetime('now', '-10 minutes')").Scan(&rodaliesCount)
	if err == nil {
		counts[models.NetworkRodalies] = rodaliesCount
	}

	// Metro count (only vehicles updated in last 10 minutes)
	var metroCount int
	err = r.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM rt_metro_vehicle_current WHERE updated_at > datetime('now', '-10 minutes')").Scan(&metroCount)
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
		WHERE updated_at > datetime('now', '-10 minutes')
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
		WHERE updated_at > datetime('now', '-10 minutes')
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

// =============================================================================
// UPTIME METHODS
// =============================================================================

// GetUptimePercent calculates uptime percentage over the last 24 hours.
// Uptime is defined as the percentage of time the status was "healthy" or "degraded".
func (r *MetricsRepository) GetUptimePercent(ctx context.Context, network string) (float64, error) {
	query := `
		SELECT
			COUNT(*) as total,
			COUNT(CASE WHEN status IN ('healthy', 'degraded') THEN 1 END) as up
		FROM metrics_health_history
		WHERE network = ?
		  AND datetime(recorded_at) >= datetime('now', '-24 hours')
	`

	var total, up int
	err := r.db.QueryRowContext(ctx, query, network).Scan(&total, &up)
	if err != nil {
		return 0, err
	}

	if total == 0 {
		return 100.0, nil // No data means we assume it was up
	}

	return float64(up) / float64(total) * 100, nil
}

// =============================================================================
// HEALTH HISTORY METHODS
// =============================================================================

// GetHealthHistory returns health history points for a network over the specified hours.
// Points are sampled to return approximately 120 points for sparkline display.
func (r *MetricsRepository) GetHealthHistory(ctx context.Context, network string, hours int) ([]models.HealthHistoryPoint, error) {
	// Calculate sampling interval to get ~120 points
	// At 30s intervals: 2 hours = 240 points, so sample every 2nd point
	// For 24 hours = 2880 points, sample every 24th point
	totalExpectedPoints := hours * 120 // 120 points per hour at 30s intervals
	sampleInterval := 1
	if totalExpectedPoints > 120 {
		sampleInterval = totalExpectedPoints / 120
	}

	query := `
		WITH numbered AS (
			SELECT
				recorded_at,
				health_score,
				vehicle_count,
				status,
				ROW_NUMBER() OVER (ORDER BY recorded_at ASC) as rn
			FROM metrics_health_history
			WHERE network = ?
			  AND datetime(recorded_at) >= datetime('now', '-' || ? || ' hours')
		)
		SELECT recorded_at, health_score, vehicle_count, status
		FROM numbered
		WHERE rn % ? = 0 OR rn = 1
		ORDER BY recorded_at ASC
		LIMIT 150
	`

	rows, err := r.db.QueryContext(ctx, query, network, hours, sampleInterval)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var points []models.HealthHistoryPoint
	for rows.Next() {
		var recordedAt string
		var p models.HealthHistoryPoint

		if err := rows.Scan(&recordedAt, &p.HealthScore, &p.VehicleCount, &p.Status); err != nil {
			continue
		}

		if t, err := time.Parse(time.RFC3339, recordedAt); err == nil {
			p.Timestamp = t
		}

		points = append(points, p)
	}

	return points, nil
}

// =============================================================================
// ALERTS METHODS
// =============================================================================

// GetActiveAlerts returns active service alerts, optionally filtered by route and language
func (r *MetricsRepository) GetActiveAlerts(ctx context.Context, routeID string, lang string) ([]models.ServiceAlert, error) {
	var query string
	var args []interface{}

	if routeID != "" {
		query = `
			SELECT DISTINCT a.alert_id, a.cause, a.effect,
				a.description_es, a.description_ca, a.description_en,
				a.is_active, a.first_seen_at, a.active_period_start, a.active_period_end, a.resolved_at
			FROM rt_alerts a
			JOIN rt_alert_entities e ON e.alert_id = a.alert_id
			WHERE a.is_active = 1 AND e.route_id = ?
			ORDER BY a.first_seen_at DESC
		`
		args = []interface{}{routeID}
	} else {
		query = `
			SELECT a.alert_id, a.cause, a.effect,
				a.description_es, a.description_ca, a.description_en,
				a.is_active, a.first_seen_at, a.active_period_start, a.active_period_end, a.resolved_at
			FROM rt_alerts a
			WHERE a.is_active = 1
			ORDER BY a.first_seen_at DESC
		`
	}

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var alerts []models.ServiceAlert
	for rows.Next() {
		var a models.ServiceAlert
		var descES, descCA, descEN sql.NullString
		var isActive int

		if err := rows.Scan(
			&a.AlertID, &a.Cause, &a.Effect,
			&descES, &descCA, &descEN,
			&isActive, &a.FirstSeenAt, &a.ActivePeriodStart, &a.ActivePeriodEnd, &a.ResolvedAt,
		); err != nil {
			continue
		}

		a.IsActive = isActive == 1

		// Select description by language with fallback to Spanish
		switch lang {
		case "ca":
			if descCA.Valid && descCA.String != "" {
				a.DescriptionText = descCA.String
			} else if descES.Valid {
				a.DescriptionText = descES.String
			}
		case "en":
			if descEN.Valid && descEN.String != "" {
				a.DescriptionText = descEN.String
			} else if descES.Valid {
				a.DescriptionText = descES.String
			}
		default:
			if descES.Valid {
				a.DescriptionText = descES.String
			}
		}

		// Fetch affected routes and extract clean Rodalies line codes
		// Check route_id and trip_id since the line code can appear in either
		routeRows, err := r.db.QueryContext(ctx,
			`SELECT DISTINCT route_id, trip_id FROM rt_alert_entities
			 WHERE alert_id = ? AND (route_id != '' OR trip_id != '')`,
			a.AlertID,
		)
		if err == nil {
			seen := make(map[string]bool)
			for routeRows.Next() {
				var rid, tid string
				if routeRows.Scan(&rid, &tid) == nil {
					// Try route_id first, then trip_id
					for _, field := range []string{rid, tid} {
						if m := rodaliesLineCodeRe.FindString(field); m != "" {
							code := strings.ToUpper(m)
							if !seen[code] {
								seen[code] = true
								a.AffectedRoutes = append(a.AffectedRoutes, code)
							}
						}
					}
				}
			}
			routeRows.Close()
		}
		if a.AffectedRoutes == nil {
			a.AffectedRoutes = []string{}
		}

		alerts = append(alerts, a)
	}

	if alerts == nil {
		alerts = []models.ServiceAlert{}
	}

	return alerts, nil
}

// =============================================================================
// DELAY STATS METHODS
// =============================================================================

// GetCurrentDelaySummary returns a live delay snapshot from current vehicle data
func (r *MetricsRepository) GetCurrentDelaySummary(ctx context.Context) (*models.DelaySummary, error) {
	query := `
		SELECT
			COUNT(*) as total,
			COUNT(CASE WHEN ABS(arrival_delay_seconds) > 300 THEN 1 END) as delayed,
			COALESCE(AVG(CASE WHEN arrival_delay_seconds IS NOT NULL THEN arrival_delay_seconds END), 0) as avg_delay,
			COALESCE(MAX(ABS(CASE WHEN arrival_delay_seconds IS NOT NULL THEN arrival_delay_seconds END)), 0) as max_delay
		FROM rt_rodalies_vehicle_current
		WHERE updated_at > datetime('now', '-10 minutes')
			AND arrival_delay_seconds IS NOT NULL
	`

	var total, delayed, maxDelay int
	var avgDelay float64

	err := r.db.QueryRowContext(ctx, query).Scan(&total, &delayed, &avgDelay, &maxDelay)
	if err != nil {
		return nil, err
	}

	summary := &models.DelaySummary{
		TotalTrains:     total,
		DelayedTrains:   delayed,
		AvgDelaySeconds: avgDelay,
		MaxDelaySeconds: maxDelay,
	}

	if total > 0 {
		summary.OnTimePercent = float64(total-delayed) / float64(total) * 100
	} else {
		summary.OnTimePercent = 100
	}

	// Find worst route
	worstQuery := `
		SELECT route_id, AVG(ABS(arrival_delay_seconds)) as avg_delay
		FROM rt_rodalies_vehicle_current
		WHERE updated_at > datetime('now', '-10 minutes')
			AND arrival_delay_seconds IS NOT NULL
			AND route_id IS NOT NULL
		GROUP BY route_id
		ORDER BY avg_delay DESC
		LIMIT 1
	`
	var worstRoute sql.NullString
	var worstAvg float64
	if r.db.QueryRowContext(ctx, worstQuery).Scan(&worstRoute, &worstAvg) == nil && worstRoute.Valid {
		summary.WorstRoute = worstRoute.String
	}

	return summary, nil
}

// GetHourlyDelayStats returns hourly delay statistics, optionally filtered by route
func (r *MetricsRepository) GetHourlyDelayStats(ctx context.Context, routeID string, hours int) ([]models.DelayHourlyStat, error) {
	var query string
	var args []interface{}

	if routeID != "" {
		query = `
			SELECT route_id, hour_bucket, observation_count,
				delay_mean_seconds, delay_m2, delayed_count, on_time_count, max_delay_seconds
			FROM stats_delay_hourly
			WHERE route_id = ? AND datetime(hour_bucket) >= datetime('now', '-' || ? || ' hours')
			ORDER BY hour_bucket ASC
		`
		args = []interface{}{routeID, hours}
	} else {
		query = `
			SELECT route_id, hour_bucket, observation_count,
				delay_mean_seconds, delay_m2, delayed_count, on_time_count, max_delay_seconds
			FROM stats_delay_hourly
			WHERE datetime(hour_bucket) >= datetime('now', '-' || ? || ' hours')
			ORDER BY hour_bucket ASC
		`
		args = []interface{}{hours}
	}

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var stats []models.DelayHourlyStat
	for rows.Next() {
		var s models.DelayHourlyStat
		var m2 float64
		var delayedCount, onTimeCount int

		if err := rows.Scan(
			&s.RouteID, &s.HourBucket, &s.ObservationCount,
			&s.MeanDelaySeconds, &m2, &delayedCount, &onTimeCount, &s.MaxDelaySeconds,
		); err != nil {
			continue
		}

		// Compute standard deviation from M2
		if s.ObservationCount >= 2 {
			variance := m2 / float64(s.ObservationCount)
			s.StdDevSeconds = math.Sqrt(variance)
		}

		// Compute on-time percentage
		total := delayedCount + onTimeCount
		if total > 0 {
			s.OnTimePercent = float64(onTimeCount) / float64(total) * 100
		} else {
			s.OnTimePercent = 100
		}

		stats = append(stats, s)
	}

	if stats == nil {
		stats = []models.DelayHourlyStat{}
	}

	return stats, nil
}

// GetDelayedTrains returns trains currently delayed more than 5 minutes with stop context
func (r *MetricsRepository) GetDelayedTrains(ctx context.Context) ([]models.DelayedTrain, error) {
	query := `
		SELECT
			v.vehicle_label,
			COALESCE(v.route_id, ''),
			v.arrival_delay_seconds,
			COALESCE(ps.stop_name, ''),
			COALESCE(ns.stop_name, ''),
			COALESCE(v.status, '')
		FROM rt_rodalies_vehicle_current v
		LEFT JOIN dim_stops ps ON v.previous_stop_id = ps.stop_id AND ps.network = 'rodalies'
		LEFT JOIN dim_stops ns ON v.next_stop_id = ns.stop_id AND ns.network = 'rodalies'
		WHERE v.updated_at > datetime('now', '-10 minutes')
			AND v.arrival_delay_seconds IS NOT NULL
			AND ABS(v.arrival_delay_seconds) > 300
		ORDER BY v.arrival_delay_seconds DESC
	`

	rows, err := r.db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var trains []models.DelayedTrain
	for rows.Next() {
		var t models.DelayedTrain
		var routeID string
		var delaySec int

		if err := rows.Scan(
			&t.VehicleLabel, &routeID, &delaySec,
			&t.PrevStopName, &t.NextStopName, &t.Status,
		); err != nil {
			continue
		}

		t.DelaySeconds = delaySec

		// Extract clean line code from vehicle_label (e.g. "R4-77626-PLATF.(1)" → "R4")
		if m := rodaliesLineCodeRe.FindString(t.VehicleLabel); m != "" {
			t.LineCode = strings.ToUpper(m)
		} else if m := rodaliesLineCodeRe.FindString(routeID); m != "" {
			t.LineCode = strings.ToUpper(m)
		}

		trains = append(trains, t)
	}

	if trains == nil {
		trains = []models.DelayedTrain{}
	}

	return trains, nil
}
