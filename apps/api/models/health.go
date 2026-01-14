package models

import "time"

// NetworkType represents a transit network
type NetworkType string

const (
	NetworkRodalies NetworkType = "rodalies"
	NetworkMetro    NetworkType = "metro"
	NetworkBus      NetworkType = "bus"
	NetworkTram     NetworkType = "tram"
	NetworkFGC      NetworkType = "fgc"
)

// AllNetworks returns all supported network types
func AllNetworks() []NetworkType {
	return []NetworkType{
		NetworkRodalies,
		NetworkMetro,
		NetworkBus,
		NetworkTram,
		NetworkFGC,
	}
}

// DataFreshness represents the freshness status of data for a network
type DataFreshness struct {
	Network      NetworkType `json:"network"`
	LastPolledAt *time.Time  `json:"lastPolledAt"`
	AgeSeconds   int         `json:"ageSeconds"`
	Status       string      `json:"status"` // "fresh", "stale", "unavailable"
	VehicleCount int         `json:"vehicleCount"`
}

// NetworkHealth represents the health status of a transit network
type NetworkHealth struct {
	Network           NetworkType `json:"network"`
	HealthScore       int         `json:"healthScore"`       // 0-100
	Status            string      `json:"status"`            // "healthy", "degraded", "unhealthy", "unknown"
	DataFreshness     int         `json:"dataFreshness"`     // 0-100 score
	ServiceLevel      int         `json:"serviceLevel"`      // 0-100 score (actual vs expected)
	DataQuality       int         `json:"dataQuality"`       // 0-100 score
	VehicleCount      int         `json:"vehicleCount"`
	ExpectedCount     *int        `json:"expectedCount,omitempty"`
	LastUpdated       time.Time   `json:"lastUpdated"`
	ConfidenceLevel   string      `json:"confidenceLevel"`   // "high", "medium", "low"
	ActiveAnomalies   int         `json:"activeAnomalies"`
}

// OverallHealth represents the overall system health
type OverallHealth struct {
	Status          string          `json:"status"`          // "operational", "degraded", "outage"
	HealthScore     int             `json:"healthScore"`     // 0-100
	Networks        []NetworkHealth `json:"networks"`
	LastUpdated     time.Time       `json:"lastUpdated"`
	UptimePercent   float64         `json:"uptimePercent"`   // Last 24h
	ActiveIncidents int             `json:"activeIncidents"`
}

// AnomalyEvent represents a detected anomaly
type AnomalyEvent struct {
	ID            int64       `json:"id"`
	DetectedAt    time.Time   `json:"detectedAt"`
	Network       NetworkType `json:"network"`
	AnomalyType   string      `json:"anomalyType"`   // "low_vehicle_count", "stale_data", "api_failure"
	Severity      string      `json:"severity"`      // "info", "warning", "critical"
	ExpectedValue *float64    `json:"expectedValue,omitempty"`
	ActualValue   *float64    `json:"actualValue,omitempty"`
	ZScore        *float64    `json:"zScore,omitempty"`
	Description   string      `json:"description"`
	ResolvedAt    *time.Time  `json:"resolvedAt,omitempty"`
	IsActive      bool        `json:"isActive"`
}

// NetworkBaseline represents expected vehicle counts for a network
type NetworkBaseline struct {
	Network            NetworkType `json:"network"`
	HourOfDay          int         `json:"hourOfDay"`
	DayOfWeek          int         `json:"dayOfWeek"`
	VehicleCountMean   float64     `json:"vehicleCountMean"`
	VehicleCountStdDev float64     `json:"vehicleCountStdDev"`
	SampleCount        int         `json:"sampleCount"`
}

// HealthStatus constants
const (
	StatusHealthy     = "healthy"
	StatusDegraded    = "degraded"
	StatusUnhealthy   = "unhealthy"
	StatusUnknown     = "unknown"
	StatusOperational = "operational"
	StatusOutage      = "outage"
)

// FreshnessStatus constants
const (
	FreshnessFresh       = "fresh"       // < 60s
	FreshnessStale       = "stale"       // 60s - 5min
	FreshnessUnavailable = "unavailable" // > 5min or no data
)

// CalculateFreshnessStatus returns the freshness status based on age
func CalculateFreshnessStatus(ageSeconds int) string {
	if ageSeconds < 0 {
		return FreshnessUnavailable
	}
	if ageSeconds < 60 {
		return FreshnessFresh
	}
	if ageSeconds < 300 {
		return FreshnessStale
	}
	return FreshnessUnavailable
}

// CalculateFreshnessScore returns a 0-100 score based on data age
func CalculateFreshnessScore(ageSeconds int) int {
	if ageSeconds < 0 {
		return 0
	}
	if ageSeconds <= 30 {
		return 100
	}
	if ageSeconds >= 300 {
		return 0
	}
	// Linear decay from 100 at 30s to 0 at 300s
	return 100 - ((ageSeconds - 30) * 100 / 270)
}

// CalculateHealthStatus returns health status based on score
func CalculateHealthStatus(score int) string {
	if score >= 80 {
		return StatusHealthy
	}
	if score >= 50 {
		return StatusDegraded
	}
	if score > 0 {
		return StatusUnhealthy
	}
	return StatusUnknown
}
