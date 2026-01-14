package handlers

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"time"

	"github.com/you/myapp/apps/api/models"
)

// MetricsRepository defines the interface for metrics operations
type MetricsRepository interface {
	GetDataFreshness(ctx context.Context) ([]models.DataFreshness, error)
	GetNetworkVehicleCounts(ctx context.Context) (map[models.NetworkType]int, error)
	GetLatestSnapshot(ctx context.Context) (*time.Time, error)
	GetRodaliesDataQuality(ctx context.Context) (total int, withGPS int, err error)
	GetMetroDataQuality(ctx context.Context) (total int, highConfidence int, err error)
	// Baseline methods
	GetBaseline(ctx context.Context, network models.NetworkType, hour, dayOfWeek int) (*models.NetworkBaseline, error)
	GetAllBaselines(ctx context.Context, network models.NetworkType) ([]models.NetworkBaseline, error)
	SaveBaseline(ctx context.Context, baseline models.NetworkBaseline) error
	// Anomaly methods
	GetActiveAnomalies(ctx context.Context) ([]models.AnomalyEvent, error)
	GetActiveAnomalyCount(ctx context.Context, network models.NetworkType) (int, error)
	RecordAnomaly(ctx context.Context, network models.NetworkType, actualCount int, expectedCount, zScore float64, severity string) error
	ResolveAnomaly(ctx context.Context, network models.NetworkType) error
}

// HealthHandler handles HTTP requests for health and metrics data
type HealthHandler struct {
	repo MetricsRepository
}

// NewHealthHandler creates a new handler with the given repository
func NewHealthHandler(repo MetricsRepository) *HealthHandler {
	return &HealthHandler{repo: repo}
}

// DataFreshnessResponse is the JSON response for GET /api/health/data
type DataFreshnessResponse struct {
	Networks    []models.DataFreshness `json:"networks"`
	LastChecked time.Time              `json:"lastChecked"`
}

// NetworkHealthResponse is the JSON response for GET /api/health/networks
type NetworkHealthResponse struct {
	Overall  models.OverallHealth  `json:"overall"`
	Networks []models.NetworkHealth `json:"networks"`
}

// GetDataFreshness handles GET /api/health/data
// Returns data freshness information for all networks
func (h *HealthHandler) GetDataFreshness(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	freshness, err := h.repo.GetDataFreshness(ctx)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(ErrorResponse{
			Error: "Failed to get data freshness",
		})
		return
	}

	response := DataFreshnessResponse{
		Networks:    freshness,
		LastChecked: time.Now().UTC(),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)
}

// GetNetworkHealth handles GET /api/health/networks
// Returns health scores and status for all networks
func (h *HealthHandler) GetNetworkHealth(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	now := time.Now().UTC()
	networkHealths := make([]models.NetworkHealth, 0, 5)

	// Get data freshness for all networks
	freshness, err := h.repo.GetDataFreshness(ctx)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(ErrorResponse{
			Error: "Failed to get network health",
		})
		return
	}

	// Calculate health for each network
	for _, f := range freshness {
		health := h.calculateNetworkHealth(ctx, f, now)
		networkHealths = append(networkHealths, health)
	}

	// Calculate overall health
	overall := h.calculateOverallHealth(networkHealths, now)

	response := NetworkHealthResponse{
		Overall:  overall,
		Networks: networkHealths,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)
}

// calculateNetworkHealth calculates health score for a single network
func (h *HealthHandler) calculateNetworkHealth(ctx context.Context, f models.DataFreshness, now time.Time) models.NetworkHealth {
	health := models.NetworkHealth{
		Network:      f.Network,
		VehicleCount: f.VehicleCount,
		LastUpdated:  now,
	}

	// Data freshness score (30% weight)
	freshnessScore := models.CalculateFreshnessScore(f.AgeSeconds)
	health.DataFreshness = freshnessScore

	// Data quality score (20% weight)
	dataQualityScore := 100
	if f.Network == models.NetworkRodalies {
		total, withGPS, err := h.repo.GetRodaliesDataQuality(ctx)
		if err == nil && total > 0 {
			dataQualityScore = (withGPS * 100) / total
		}
	} else if f.Network == models.NetworkMetro {
		total, highConf, err := h.repo.GetMetroDataQuality(ctx)
		if err == nil && total > 0 {
			dataQualityScore = (highConf * 100) / total
		}
	}
	health.DataQuality = dataQualityScore

	// Service level score (40% weight) - compare against baselines
	serviceLevelScore := 100
	if f.VehicleCount == 0 && (f.Network == models.NetworkRodalies || f.Network == models.NetworkMetro) {
		serviceLevelScore = 0
	} else if f.VehicleCount > 0 {
		// Compare against baseline if available
		baseline, err := h.repo.GetBaseline(ctx, f.Network, now.Hour(), int(now.Weekday()))
		if err == nil && baseline != nil && baseline.SampleCount >= 7 {
			expectedCount := int(baseline.VehicleCountMean)
			health.ExpectedCount = &expectedCount

			// Calculate service level based on deviation from baseline
			if baseline.VehicleCountMean > 0 {
				ratio := float64(f.VehicleCount) / baseline.VehicleCountMean
				if ratio >= 0.8 {
					serviceLevelScore = 100
				} else if ratio >= 0.5 {
					serviceLevelScore = int(ratio * 100)
				} else {
					serviceLevelScore = int(ratio * 50)
				}
			}

			// Anomaly detection using Z-score
			if baseline.VehicleCountStdDev > 0 {
				zScore := (float64(f.VehicleCount) - baseline.VehicleCountMean) / baseline.VehicleCountStdDev

				// Detect anomaly (|Z| > 2 = warning, |Z| > 3 = critical)
				if math.Abs(zScore) > 2.0 {
					severity := "warning"
					if math.Abs(zScore) > 3.0 {
						severity = "critical"
					}
					_ = h.repo.RecordAnomaly(ctx, f.Network, f.VehicleCount, baseline.VehicleCountMean, zScore, severity)
				} else {
					// Resolve any existing anomaly when back to normal
					_ = h.repo.ResolveAnomaly(ctx, f.Network)
				}
			}
		}
	}
	health.ServiceLevel = serviceLevelScore

	// Get active anomaly count for this network
	anomalyCount, err := h.repo.GetActiveAnomalyCount(ctx, f.Network)
	if err == nil {
		health.ActiveAnomalies = anomalyCount
	}

	// API health (10% weight) - simplified for now
	apiHealthScore := 100
	if f.Status == models.FreshnessUnavailable {
		apiHealthScore = 0
	}

	// Calculate weighted overall health score
	health.HealthScore = (freshnessScore*30 + serviceLevelScore*40 + dataQualityScore*20 + apiHealthScore*10) / 100
	health.Status = models.CalculateHealthStatus(health.HealthScore)

	// Determine confidence level based on data source type
	// - Rodalies: Real-time GPS data from API → high confidence
	// - Metro: Real-time schedule interpolation → medium confidence
	// - Bus/Tram/FGC: Static schedule-based positioning → low confidence
	switch f.Network {
	case models.NetworkRodalies:
		// Real GPS data - high confidence unless data is stale/unavailable
		if f.Status == models.FreshnessUnavailable || f.VehicleCount == 0 {
			health.ConfidenceLevel = "low"
		} else if f.AgeSeconds > 60 {
			health.ConfidenceLevel = "medium"
		} else {
			health.ConfidenceLevel = "high"
		}
	case models.NetworkMetro:
		// Interpolated positions from real-time schedule - medium confidence
		if f.Status == models.FreshnessUnavailable || f.VehicleCount == 0 {
			health.ConfidenceLevel = "low"
		} else {
			health.ConfidenceLevel = "medium"
		}
	case models.NetworkBus, models.NetworkTram, models.NetworkFGC:
		// Static schedule-based positioning - always low confidence
		health.ConfidenceLevel = "low"
	default:
		health.ConfidenceLevel = "low"
	}

	return health
}

// calculateOverallHealth calculates overall system health from network healths
func (h *HealthHandler) calculateOverallHealth(networks []models.NetworkHealth, now time.Time) models.OverallHealth {
	if len(networks) == 0 {
		return models.OverallHealth{
			Status:      models.StatusUnknown,
			HealthScore: 0,
			LastUpdated: now,
		}
	}

	// Calculate average health score (weighted by importance)
	// Rodalies and Metro are more important as they're real-time
	totalWeight := 0
	weightedScore := 0

	for _, n := range networks {
		weight := 1
		if n.Network == models.NetworkRodalies || n.Network == models.NetworkMetro {
			weight = 2 // Real-time networks are more important
		}
		weightedScore += n.HealthScore * weight
		totalWeight += weight
	}

	avgScore := 0
	if totalWeight > 0 {
		avgScore = weightedScore / totalWeight
	}

	// Determine overall status
	status := models.StatusOperational
	unhealthyCount := 0
	for _, n := range networks {
		if n.Status == models.StatusUnhealthy || n.Status == models.StatusUnknown {
			unhealthyCount++
		}
	}

	if unhealthyCount > len(networks)/2 {
		status = models.StatusOutage
	} else if unhealthyCount > 0 || avgScore < 80 {
		status = models.StatusDegraded
	}

	// Count total active anomalies across all networks
	activeIncidents := 0
	for _, n := range networks {
		activeIncidents += n.ActiveAnomalies
	}

	return models.OverallHealth{
		Status:          status,
		HealthScore:     avgScore,
		Networks:        networks,
		LastUpdated:     now,
		UptimePercent:   99.9, // TODO: Calculate from historical data
		ActiveIncidents: activeIncidents,
	}
}

// =============================================================================
// BASELINE & ANOMALY ENDPOINTS
// =============================================================================

// BaselinesResponse is the JSON response for GET /api/health/baselines
type BaselinesResponse struct {
	Baselines   map[string][]models.NetworkBaseline `json:"baselines"`
	LastChecked time.Time                           `json:"lastChecked"`
}

// AnomaliesResponse is the JSON response for GET /api/health/anomalies
type AnomaliesResponse struct {
	Anomalies   []models.AnomalyEvent `json:"anomalies"`
	Count       int                   `json:"count"`
	LastChecked time.Time             `json:"lastChecked"`
}

// GetBaselines handles GET /api/health/baselines
// Returns all baselines for all networks
func (h *HealthHandler) GetBaselines(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	baselines := make(map[string][]models.NetworkBaseline)

	for _, network := range models.AllNetworks() {
		networkBaselines, err := h.repo.GetAllBaselines(ctx, network)
		if err == nil && len(networkBaselines) > 0 {
			baselines[string(network)] = networkBaselines
		}
	}

	response := BaselinesResponse{
		Baselines:   baselines,
		LastChecked: time.Now().UTC(),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)
}

// GetAnomalies handles GET /api/health/anomalies
// Returns all active anomalies
func (h *HealthHandler) GetAnomalies(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	anomalies, err := h.repo.GetActiveAnomalies(ctx)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(ErrorResponse{
			Error: "Failed to get anomalies",
		})
		return
	}

	if anomalies == nil {
		anomalies = []models.AnomalyEvent{}
	}

	response := AnomaliesResponse{
		Anomalies:   anomalies,
		Count:       len(anomalies),
		LastChecked: time.Now().UTC(),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)
}
