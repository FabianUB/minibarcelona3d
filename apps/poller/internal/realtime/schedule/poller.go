package schedule

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/mini-rodalies-3d/poller/internal/config"
	"github.com/mini-rodalies-3d/poller/internal/db"
)

// Poller handles schedule-based position polling for TRAM, FGC, and Bus
type Poller struct {
	db        *db.DB
	cfg       *config.Config
	estimator *Estimator
}

// NewPoller creates a new schedule poller
func NewPoller(database *db.DB, cfg *config.Config) (*Poller, error) {
	estimator, err := NewEstimator(database.Conn())
	if err != nil {
		return nil, fmt.Errorf("failed to create estimator: %w", err)
	}

	return &Poller{
		db:        database,
		cfg:       cfg,
		estimator: estimator,
	}, nil
}

// Poll estimates positions for all schedule-based networks and writes to database
func (p *Poller) Poll(ctx context.Context) error {
	polledAt := time.Now().UTC()

	// Estimate positions
	positions, err := p.estimator.EstimatePositions(ctx, polledAt)
	if err != nil {
		return fmt.Errorf("failed to estimate positions: %w", err)
	}

	if len(positions) == 0 {
		log.Println("Schedule: no positions estimated")
		return nil
	}

	// Create snapshot
	snapshotID, err := p.db.CreateSnapshot(ctx, polledAt)
	if err != nil {
		return fmt.Errorf("failed to create snapshot: %w", err)
	}

	// Convert to database format
	dbPositions := make([]db.SchedulePosition, 0, len(positions))
	for _, pos := range positions {
		dbPos := db.SchedulePosition{
			VehicleKey:         pos.VehicleKey,
			NetworkType:        pos.NetworkType,
			RouteID:            pos.RouteID,
			RouteShortName:     pos.RouteShortName,
			RouteColor:         pos.RouteColor,
			TripID:             pos.TripID,
			DirectionID:        pos.DirectionID,
			Latitude:           pos.Latitude,
			Longitude:          pos.Longitude,
			Bearing:            pos.Bearing,
			PreviousStopID:     pos.PreviousStopID,
			NextStopID:         pos.NextStopID,
			PreviousStopName:   pos.PreviousStopName,
			NextStopName:       pos.NextStopName,
			Status:             pos.Status,
			ProgressFraction:   pos.ProgressFraction,
			ScheduledArrival:   pos.ScheduledArrival,
			ScheduledDeparture: pos.ScheduledDeparture,
			Source:             pos.Source,
			Confidence:         pos.Confidence,
			EstimatedAt:        pos.EstimatedAt,
		}
		dbPositions = append(dbPositions, dbPos)
	}

	// Write to database
	if err := p.db.UpsertSchedulePositions(ctx, snapshotID, polledAt, dbPositions); err != nil {
		return fmt.Errorf("failed to write positions: %w", err)
	}

	// Count by network type
	tramCount := 0
	fgcCount := 0
	busCount := 0
	for _, pos := range positions {
		switch pos.NetworkType {
		case NetworkTram:
			tramCount++
		case NetworkFGC:
			fgcCount++
		case NetworkBus:
			busCount++
		}
	}

	log.Printf("Schedule: polled %d vehicles (tram=%d, fgc=%d, bus=%d)",
		len(positions), tramCount, fgcCount, busCount)

	return nil
}

// ClearCache clears the estimator's cache
func (p *Poller) ClearCache() {
	p.estimator.ClearCache()
}
