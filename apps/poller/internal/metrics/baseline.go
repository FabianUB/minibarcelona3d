package metrics

import (
	"context"
	"log"
	"time"
)

// NetworkType represents a transit network type
type NetworkType string

const (
	NetworkRodalies NetworkType = "rodalies"
	NetworkMetro    NetworkType = "metro"
	NetworkBus      NetworkType = "bus"
	NetworkTram     NetworkType = "tram"
	NetworkFGC      NetworkType = "fgc"
)

// AllNetworks returns all network types
func AllNetworks() []NetworkType {
	return []NetworkType{NetworkRodalies, NetworkMetro, NetworkBus, NetworkTram, NetworkFGC}
}

// NetworkBaseline represents baseline statistics for a network
type NetworkBaseline struct {
	Network            NetworkType
	HourOfDay          int
	DayOfWeek          int
	VehicleCountMean   float64
	VehicleCountStdDev float64
	SampleCount        int
}

// HealthStatus represents a recorded health status
type HealthStatus struct {
	Network      string
	HealthScore  int
	Status       string
	VehicleCount int
}

// BaselineStore defines the interface for baseline persistence
type BaselineStore interface {
	GetBaseline(ctx context.Context, network NetworkType, hour, dayOfWeek int) (*NetworkBaseline, error)
	SaveBaseline(ctx context.Context, baseline NetworkBaseline) error
	GetVehicleCount(ctx context.Context, network NetworkType) (int, error)
	RecordHealthStatus(ctx context.Context, status HealthStatus) error
	CleanupHealthHistory(ctx context.Context) error
}

// BaselineLearner handles incremental baseline updates using Welford's algorithm
type BaselineLearner struct {
	store BaselineStore
}

// NewBaselineLearner creates a new baseline learner
func NewBaselineLearner(store BaselineStore) *BaselineLearner {
	return &BaselineLearner{store: store}
}

// UpdateBaselines updates baselines for all networks using current vehicle counts.
// Called after each polling cycle to gradually learn expected patterns.
func (l *BaselineLearner) UpdateBaselines(ctx context.Context) error {
	now := time.Now()
	hour := now.Hour()
	dayOfWeek := int(now.Weekday())

	for _, network := range AllNetworks() {
		if err := l.updateNetworkBaseline(ctx, network, hour, dayOfWeek); err != nil {
			log.Printf("Baseline: failed to update %s: %v", network, err)
			// Continue with other networks
		}
	}

	return nil
}

// updateNetworkBaseline updates baseline for a single network
func (l *BaselineLearner) updateNetworkBaseline(ctx context.Context, network NetworkType, hour, dayOfWeek int) error {
	// Get current vehicle count
	count, err := l.store.GetVehicleCount(ctx, network)
	if err != nil {
		return err
	}

	// Skip if no vehicles (avoid skewing baseline during outages)
	if count == 0 {
		return nil
	}

	// Get existing baseline
	existing, err := l.store.GetBaseline(ctx, network, hour, dayOfWeek)
	if err != nil {
		return err
	}

	// Create Welford state from existing baseline
	var welford *WelfordState
	if existing != nil {
		welford = NewWelfordState(existing.VehicleCountMean, existing.VehicleCountStdDev, existing.SampleCount)
	} else {
		welford = &WelfordState{}
	}

	// Update with new observation
	welford.Update(float64(count))

	// Save updated baseline
	baseline := NetworkBaseline{
		Network:            network,
		HourOfDay:          hour,
		DayOfWeek:          dayOfWeek,
		VehicleCountMean:   welford.GetMean(),
		VehicleCountStdDev: welford.GetStdDev(),
		SampleCount:        welford.GetCount(),
	}

	return l.store.SaveBaseline(ctx, baseline)
}

// RecordHealthStatuses records health status for all networks.
// Called after each polling cycle for uptime tracking.
func (l *BaselineLearner) RecordHealthStatuses(ctx context.Context) error {
	for _, network := range AllNetworks() {
		count, err := l.store.GetVehicleCount(ctx, network)
		if err != nil {
			log.Printf("Health status: failed to get count for %s: %v", network, err)
			continue
		}

		// Determine health based on vehicle count
		healthScore := 0
		status := "unknown"
		if count > 0 {
			healthScore = 100
			status = "healthy"
		} else {
			status = "unhealthy"
		}

		err = l.store.RecordHealthStatus(ctx, HealthStatus{
			Network:      string(network),
			HealthScore:  healthScore,
			Status:       status,
			VehicleCount: count,
		})
		if err != nil {
			log.Printf("Health status: failed to record for %s: %v", network, err)
		}
	}

	// Record overall health
	totalScore := 0
	validNetworks := 0
	for _, network := range AllNetworks() {
		count, err := l.store.GetVehicleCount(ctx, network)
		if err != nil {
			continue
		}
		if count > 0 {
			totalScore += 100
		}
		validNetworks++
	}

	overallScore := 0
	overallStatus := "unknown"
	if validNetworks > 0 {
		overallScore = totalScore / validNetworks
		if overallScore >= 80 {
			overallStatus = "healthy"
		} else if overallScore >= 50 {
			overallStatus = "degraded"
		} else {
			overallStatus = "unhealthy"
		}
	}

	err := l.store.RecordHealthStatus(ctx, HealthStatus{
		Network:      "overall",
		HealthScore:  overallScore,
		Status:       overallStatus,
		VehicleCount: 0,
	})
	if err != nil {
		log.Printf("Health status: failed to record overall: %v", err)
	}

	// Cleanup old health history (keep 48 hours)
	if err := l.store.CleanupHealthHistory(ctx); err != nil {
		log.Printf("Health status: cleanup failed: %v", err)
	}

	return nil
}
