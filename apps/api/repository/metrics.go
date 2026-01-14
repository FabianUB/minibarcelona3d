package repository

import (
	"context"
	"database/sql"
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
	query := `
		SELECT
			MAX(polled_at_utc) as last_polled,
			COUNT(*) as vehicle_count
		FROM rt_rodalies_vehicle_current
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
	// We just need to check if the schedule data exists
	networks := []models.NetworkType{models.NetworkBus, models.NetworkTram, models.NetworkFGC}
	result := make([]models.DataFreshness, 0, len(networks))

	for _, network := range networks {
		result = append(result, models.DataFreshness{
			Network:      network,
			AgeSeconds:   0,
			Status:       models.FreshnessFresh,
			VehicleCount: -1, // Unknown for schedule-based
		})
	}

	return result
}

// GetNetworkVehicleCounts returns current vehicle counts per network
func (r *MetricsRepository) GetNetworkVehicleCounts(ctx context.Context) (map[models.NetworkType]int, error) {
	counts := make(map[models.NetworkType]int)

	// Rodalies count
	var rodaliesCount int
	err := r.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM rt_rodalies_vehicle_current").Scan(&rodaliesCount)
	if err == nil {
		counts[models.NetworkRodalies] = rodaliesCount
	}

	// Metro count
	var metroCount int
	err = r.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM rt_metro_vehicle_current").Scan(&metroCount)
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
	query := `
		SELECT
			COUNT(*) as total,
			COUNT(CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN 1 END) as with_gps
		FROM rt_rodalies_vehicle_current
	`

	err = r.db.QueryRowContext(ctx, query).Scan(&total, &withGPS)
	return
}

// GetMetroDataQuality returns data quality metrics for Metro
func (r *MetricsRepository) GetMetroDataQuality(ctx context.Context) (total int, highConfidence int, err error) {
	query := `
		SELECT
			COUNT(*) as total,
			COUNT(CASE WHEN confidence IN ('high', 'medium') THEN 1 END) as high_confidence
		FROM rt_metro_vehicle_current
	`

	err = r.db.QueryRowContext(ctx, query).Scan(&total, &highConfidence)
	return
}
