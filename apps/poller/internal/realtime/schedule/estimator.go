package schedule

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"sync"
	"time"
)

// Estimator handles schedule-based position estimation for TRAM, FGC, and Bus
type Estimator struct {
	queries        *Queries
	madridLoc      *time.Location
	stopTimesCache map[string][]TripStopTime // tripID -> stop times
	cacheMu        sync.RWMutex
}

// NewEstimator creates a new schedule estimator
func NewEstimator(db *sql.DB) (*Estimator, error) {
	loc, err := time.LoadLocation(MadridTimezone)
	if err != nil {
		return nil, fmt.Errorf("failed to load timezone: %w", err)
	}

	return &Estimator{
		queries:        NewQueries(db),
		madridLoc:      loc,
		stopTimesCache: make(map[string][]TripStopTime),
	}, nil
}

// EstimatePositions estimates vehicle positions for all schedule-based networks
func (e *Estimator) EstimatePositions(ctx context.Context, now time.Time) ([]EstimatedPosition, error) {
	// Convert to Madrid timezone
	madridTime := now.In(e.madridLoc)
	today := madridTime.Format("20060102")
	dayOfWeek := int(madridTime.Weekday())
	currentSeconds := SecondsSinceMidnight(madridTime)

	// Get active trips for TMB network (includes tram, bus, fgc)
	trips, err := e.queries.GetActiveTrips(ctx, "tmb", currentSeconds, today, dayOfWeek)
	if err != nil {
		return nil, fmt.Errorf("failed to get active trips: %w", err)
	}

	if len(trips) == 0 {
		log.Printf("Schedule: no active trips found at %s (%d seconds)", madridTime.Format("15:04:05"), currentSeconds)
		return nil, nil
	}

	// Estimate positions for each active trip
	var positions []EstimatedPosition
	for _, trip := range trips {
		pos, err := e.estimateTripPosition(ctx, trip, currentSeconds, now)
		if err != nil {
			// Log but don't fail for individual trips
			continue
		}
		if pos != nil {
			positions = append(positions, *pos)
		}
	}

	log.Printf("Schedule: estimated %d positions (%d trips active)", len(positions), len(trips))
	return positions, nil
}

// estimateTripPosition estimates the position for a single trip
func (e *Estimator) estimateTripPosition(ctx context.Context, trip ActiveTrip, currentSeconds int, now time.Time) (*EstimatedPosition, error) {
	// Get stop times for this trip (with caching)
	stopTimes, err := e.getStopTimes(ctx, trip.TripID)
	if err != nil {
		return nil, err
	}

	if len(stopTimes) < 2 {
		return nil, nil // Not enough stops to estimate position
	}

	// Find current segment (which two stops are we between?)
	prevStop, nextStop, progress := e.findCurrentSegment(stopTimes, currentSeconds)
	if prevStop == nil || nextStop == nil {
		return nil, nil // Trip hasn't started or has ended
	}

	// Interpolate position between the two stops
	lat, lng, bearing := InterpolateAlongSegment(
		prevStop.StopLat, prevStop.StopLon,
		nextStop.StopLat, nextStop.StopLon,
		progress,
	)

	// Determine status
	status := "IN_TRANSIT_TO"
	if progress >= 0.95 {
		status = "ARRIVING"
	} else if progress <= 0.05 {
		status = "STOPPED_AT"
	}

	// Format scheduled times
	schedArr := FormatTimeHHMMSS(nextStop.ArrivalSeconds)
	schedDep := FormatTimeHHMMSS(prevStop.DepartureSeconds)

	pos := &EstimatedPosition{
		VehicleKey:         fmt.Sprintf("%s-%s-%s", trip.NetworkType, trip.RouteID, trip.TripID),
		NetworkType:        trip.NetworkType,
		RouteID:            trip.RouteID,
		RouteShortName:     trip.RouteShortName,
		RouteColor:         trip.RouteColor,
		TripID:             trip.TripID,
		DirectionID:        trip.DirectionID,
		Latitude:           lat,
		Longitude:          lng,
		Bearing:            &bearing,
		PreviousStopID:     &prevStop.StopID,
		NextStopID:         &nextStop.StopID,
		PreviousStopName:   &prevStop.StopName,
		NextStopName:       &nextStop.StopName,
		Status:             status,
		ProgressFraction:   progress,
		ScheduledArrival:   &schedArr,
		ScheduledDeparture: &schedDep,
		Source:             "schedule",
		Confidence:         "low",
		EstimatedAt:        now.UTC(),
	}

	return pos, nil
}

// findCurrentSegment finds the segment the vehicle is currently on
// Returns (previousStop, nextStop, progressFraction)
func (e *Estimator) findCurrentSegment(stopTimes []TripStopTime, currentSeconds int) (*TripStopTime, *TripStopTime, float64) {
	for i := 0; i < len(stopTimes)-1; i++ {
		prevStop := &stopTimes[i]
		nextStop := &stopTimes[i+1]

		// Check if current time is within this segment
		// Segment is from prev.departure to next.arrival
		if currentSeconds >= prevStop.DepartureSeconds && currentSeconds <= nextStop.ArrivalSeconds {
			segmentDuration := nextStop.ArrivalSeconds - prevStop.DepartureSeconds
			if segmentDuration <= 0 {
				return prevStop, nextStop, 0.5 // Fallback to midpoint
			}

			elapsed := currentSeconds - prevStop.DepartureSeconds
			progress := float64(elapsed) / float64(segmentDuration)
			progress = Clamp(progress, 0.0, 1.0)

			return prevStop, nextStop, progress
		}
	}

	// If we're before the first stop's departure, we're at the first stop
	if currentSeconds < stopTimes[0].DepartureSeconds {
		return &stopTimes[0], &stopTimes[1], 0.0
	}

	// If we're past the last stop's arrival, we've finished
	return nil, nil, 0
}

// getStopTimes returns stop times for a trip, using cache if available
func (e *Estimator) getStopTimes(ctx context.Context, tripID string) ([]TripStopTime, error) {
	// Check cache first
	e.cacheMu.RLock()
	if cached, ok := e.stopTimesCache[tripID]; ok {
		e.cacheMu.RUnlock()
		return cached, nil
	}
	e.cacheMu.RUnlock()

	// Query from database
	stopTimes, err := e.queries.GetTripStopTimes(ctx, tripID)
	if err != nil {
		return nil, err
	}

	// Cache the result
	e.cacheMu.Lock()
	e.stopTimesCache[tripID] = stopTimes
	e.cacheMu.Unlock()

	return stopTimes, nil
}

// ClearCache clears the stop times cache
func (e *Estimator) ClearCache() {
	e.cacheMu.Lock()
	e.stopTimesCache = make(map[string][]TripStopTime)
	e.cacheMu.Unlock()
}

// GetEstimatedPositionsByNetwork returns positions filtered by network type
func (e *Estimator) GetEstimatedPositionsByNetwork(positions []EstimatedPosition, networkType string) []EstimatedPosition {
	var filtered []EstimatedPosition
	for _, pos := range positions {
		if pos.NetworkType == networkType {
			filtered = append(filtered, pos)
		}
	}
	return filtered
}
