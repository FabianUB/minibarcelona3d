package rodalies

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/mini-rodalies-3d/poller/internal/config"
	"github.com/mini-rodalies-3d/poller/internal/db"
	"google.golang.org/protobuf/proto"

	gtfs "github.com/MobilityData/gtfs-realtime-bindings/golang/gtfs"
)

// lineCodeRegex extracts line code from vehicleLabel (e.g., "R4-77626-PLATF.(1)" -> "R4")
var lineCodeRegex = regexp.MustCompile(`^(R\d+[NS]?|RG\d+|RL\d+|RT\d+)`)

// Poller handles real-time polling of Rodalies GTFS-RT feeds
type Poller struct {
	db     *db.DB
	cfg    *config.Config
	client *http.Client
}

// NewPoller creates a new Rodalies poller
func NewPoller(database *db.DB, cfg *config.Config) *Poller {
	return &Poller{
		db:  database,
		cfg: cfg,
		client: &http.Client{
			Timeout: 15 * time.Second,
		},
	}
}

// Poll fetches and processes GTFS-RT feeds
func (p *Poller) Poll(ctx context.Context) error {
	polledAt := time.Now().UTC()

	// Fetch vehicle positions
	positions, err := p.fetchVehiclePositions(ctx)
	if err != nil {
		return fmt.Errorf("failed to fetch vehicle positions: %w", err)
	}

	if len(positions) == 0 {
		log.Println("Rodalies: no vehicle positions found")
		return nil
	}

	// Fetch trip updates (for delay info)
	delays, _, err := p.fetchTripUpdates(ctx)
	if err != nil {
		// Non-fatal: continue without delay info
		log.Printf("Rodalies: failed to fetch trip updates (continuing without delays): %v", err)
		delays = make(map[DelayKey]TripDelay)
	}

	// Get previous vehicle states (for deriving previous_stop)
	prevStates, err := p.db.GetRodaliesVehicleStopStates(ctx)
	if err != nil {
		log.Printf("Rodalies: failed to get previous states (continuing without previous_stop): %v", err)
		prevStates = make(map[string]db.VehicleStopState)
	}

	// Create snapshot
	snapshotID, err := p.db.CreateSnapshot(ctx, polledAt)
	if err != nil {
		return fmt.Errorf("failed to create snapshot: %w", err)
	}

	// Convert to DB positions with delay info merged
	dbPositions := make([]db.RodaliesPosition, 0, len(positions))
	for _, pos := range positions {
		dbPos := db.RodaliesPosition{
			VehicleKey:       pos.VehicleKey,
			VehicleID:        pos.VehicleID,
			EntityID:         pos.EntityID,
			VehicleLabel:     pos.VehicleLabel,
			TripID:           pos.TripID,
			RouteID:          pos.RouteID,
			CurrentStopID:    pos.CurrentStopID,
			NextStopID:       pos.NextStopID,
			NextStopSequence: pos.NextStopSeq,
			Status:           pos.Status,
			Latitude:         pos.Latitude,
			Longitude:        pos.Longitude,
			VehicleTimestamp: pos.Timestamp,
		}

		// Look up delay info - use whichever stop ID is available
		var stopIDForDelay *string
		if pos.CurrentStopID != nil {
			stopIDForDelay = pos.CurrentStopID
		} else if pos.NextStopID != nil {
			stopIDForDelay = pos.NextStopID
		}
		if pos.TripID != nil && stopIDForDelay != nil {
			key := DelayKey{TripID: *pos.TripID, StopID: *stopIDForDelay}
			if delay, ok := delays[key]; ok {
				dbPos.ArrivalDelaySeconds = delay.ArrivalDelay
				dbPos.DepartureDelaySeconds = delay.DepartureDelay
				dbPos.ScheduleRelationship = delay.ScheduleRelationship
				dbPos.PredictedArrival = delay.PredictedArrival
				dbPos.PredictedDeparture = delay.PredictedDeparture
			}
		}

		// Derive previous stop from GTFS schedule (dimension tables)
		// This is more reliable than tracking vehicle state transitions
		if pos.TripID != nil {
			var stopIDForLookup *string
			if pos.CurrentStopID != nil {
				stopIDForLookup = pos.CurrentStopID
			} else if pos.NextStopID != nil {
				stopIDForLookup = pos.NextStopID
			}

			if stopIDForLookup != nil {
				adjacent, err := p.db.GetAdjacentStops(ctx, *pos.TripID, *stopIDForLookup)
				if err == nil {
					// Set stop sequence
					dbPos.NextStopSequence = &adjacent.StopSequence

					if pos.Status == "STOPPED_AT" {
						// Currently at a stop: previous is sequence-1, next is sequence+1
						dbPos.PreviousStopID = adjacent.PreviousStopID
						dbPos.NextStopID = adjacent.NextStopID
					} else {
						// Moving to next stop: previous is sequence-1
						dbPos.PreviousStopID = adjacent.PreviousStopID
					}
				}
			}
		}

		// Fallback: derive previous stop from vehicle's last known state
		if dbPos.PreviousStopID == nil {
			if prev, ok := prevStates[pos.VehicleKey]; ok {
				// If previous state was STOPPED_AT, that stop becomes the previous stop
				if prev.Status != nil && *prev.Status == "STOPPED_AT" && prev.CurrentStopID != nil {
					// Only set as previous if we're now at a different stop or moving to a new stop
					currentStop := pos.CurrentStopID
					nextStop := pos.NextStopID
					if (currentStop != nil && *currentStop != *prev.CurrentStopID) ||
						(nextStop != nil && *nextStop != *prev.CurrentStopID) ||
						(pos.Status != "STOPPED_AT") {
						dbPos.PreviousStopID = prev.CurrentStopID
					}
				}

				// Preserve existing previous_stop_id if we didn't compute a new one
				if dbPos.PreviousStopID == nil && prev.PreviousStopID != nil {
					dbPos.PreviousStopID = prev.PreviousStopID
				}
			}
		}

		dbPositions = append(dbPositions, dbPos)
	}

	// Write to database
	if err := p.db.UpsertRodaliesPositions(ctx, snapshotID, polledAt, dbPositions); err != nil {
		return fmt.Errorf("failed to write positions: %w", err)
	}

	log.Printf("Rodalies: polled %d vehicles", len(dbPositions))

	// Fetch and store service alerts (non-fatal)
	if err := p.pollAlerts(ctx); err != nil {
		log.Printf("Rodalies: failed to poll alerts (continuing): %v", err)
	}

	// Aggregate delay stats from current positions (non-fatal)
	p.aggregateDelayStats(ctx, dbPositions)

	return nil
}

// aggregateDelayStats extracts delay observations from positions and updates hourly stats
func (p *Poller) aggregateDelayStats(ctx context.Context, positions []db.RodaliesPosition) {
	var observations []db.DelayObservation
	for _, pos := range positions {
		if pos.RouteID == nil || pos.ArrivalDelaySeconds == nil {
			continue
		}
		observations = append(observations, db.DelayObservation{
			RouteID:      *pos.RouteID,
			DelaySeconds: *pos.ArrivalDelaySeconds,
		})
	}

	if len(observations) == 0 {
		return
	}

	if err := p.db.UpdateDelayStats(ctx, observations); err != nil {
		log.Printf("Rodalies: failed to update delay stats (continuing): %v", err)
	} else {
		log.Printf("Rodalies: delay stats updated for %d observations", len(observations))
	}
}

// fetchVehiclePositions fetches and parses the vehicle positions feed
func (p *Poller) fetchVehiclePositions(ctx context.Context) ([]VehiclePosition, error) {
	feed, err := p.fetchFeed(ctx, p.cfg.GTFSVehiclePositionsURL)
	if err != nil {
		return nil, err
	}

	var positions []VehiclePosition
	for _, entity := range feed.Entity {
		if entity.Vehicle == nil {
			continue
		}

		vehicle := entity.Vehicle

		// Get vehicle label
		var vehicleLabel string
		if vehicle.Vehicle != nil && vehicle.Vehicle.Label != nil {
			vehicleLabel = *vehicle.Vehicle.Label
		}

		// Filter: only Rodalies trains (labels starting with 'R')
		if vehicleLabel == "" || !strings.HasPrefix(strings.ToUpper(vehicleLabel), "R") {
			continue
		}

		pos := VehiclePosition{
			EntityID:     *entity.Id,
			VehicleLabel: vehicleLabel,
		}

		// Generate vehicle key
		if vehicle.Vehicle != nil && vehicle.Vehicle.Id != nil {
			pos.VehicleID = vehicle.Vehicle.Id
			pos.VehicleKey = *vehicle.Vehicle.Id
		} else {
			pos.VehicleKey = "entity:" + *entity.Id
		}

		// Trip info
		if vehicle.Trip != nil {
			pos.TripID = vehicle.Trip.TripId
			// Note: API route_id is unreliable, we extract from vehicleLabel instead
		}

		// Extract line code from vehicleLabel (GTFS-RT doesn't provide route_id)
		// Format: "R4-77626-PLATF.(1)" -> "R4"
		if lineCode := extractLineCode(vehicleLabel); lineCode != "" {
			pos.RouteID = &lineCode
		}

		// Position
		if vehicle.Position != nil {
			if vehicle.Position.Latitude != nil {
				lat := float64(*vehicle.Position.Latitude)
				pos.Latitude = &lat
			}
			if vehicle.Position.Longitude != nil {
				lng := float64(*vehicle.Position.Longitude)
				pos.Longitude = &lng
			}
		}

		// Status (need this first to determine stop_id meaning)
		if vehicle.CurrentStatus != nil {
			if status, ok := StatusMap[int32(*vehicle.CurrentStatus)]; ok {
				pos.Status = status
			}
		}

		// Stop info - stop_id meaning depends on status:
		// STOPPED_AT (1): stop_id is current stop
		// INCOMING_AT (0) / IN_TRANSIT_TO (2): stop_id is next stop
		if vehicle.CurrentStopSequence != nil {
			seq := int(*vehicle.CurrentStopSequence)
			pos.NextStopSeq = &seq
		}
		if vehicle.StopId != nil {
			if pos.Status == "STOPPED_AT" {
				pos.CurrentStopID = vehicle.StopId
			} else {
				// INCOMING_AT or IN_TRANSIT_TO - stop_id is the next stop
				pos.NextStopID = vehicle.StopId
			}
		}

		// Timestamp
		if vehicle.Timestamp != nil {
			ts := time.Unix(int64(*vehicle.Timestamp), 0).UTC()
			pos.Timestamp = &ts
		}

		positions = append(positions, pos)
	}

	return positions, nil
}

// fetchTripUpdates fetches and parses the trip updates feed
// Returns delay info and trip stops (for deriving previous stop)
func (p *Poller) fetchTripUpdates(ctx context.Context) (map[DelayKey]TripDelay, map[string]*TripStops, error) {
	feed, err := p.fetchFeed(ctx, p.cfg.GTFSTripUpdatesURL)
	if err != nil {
		return nil, nil, err
	}

	delays := make(map[DelayKey]TripDelay)
	tripStopsMap := make(map[string]*TripStops)

	for _, entity := range feed.Entity {
		if entity.TripUpdate == nil {
			continue
		}

		tripUpdate := entity.TripUpdate
		if tripUpdate.Trip == nil || tripUpdate.Trip.TripId == nil {
			continue
		}

		tripID := *tripUpdate.Trip.TripId

		// Collect stops for this trip
		var stops []TripStop

		for _, stu := range tripUpdate.StopTimeUpdate {
			if stu.StopId == nil {
				continue
			}

			// Build stop list with sequences
			if stu.StopSequence != nil {
				stops = append(stops, TripStop{
					StopID:       *stu.StopId,
					StopSequence: int(*stu.StopSequence),
				})
			}

			delay := TripDelay{
				TripID: tripID,
				StopID: *stu.StopId,
			}

			// Arrival info
			if stu.Arrival != nil {
				if stu.Arrival.Delay != nil {
					d := int(*stu.Arrival.Delay)
					delay.ArrivalDelay = &d
				}
				if stu.Arrival.Time != nil {
					t := time.Unix(*stu.Arrival.Time, 0).UTC()
					delay.PredictedArrival = &t
				}
			}

			// Departure info
			if stu.Departure != nil {
				if stu.Departure.Delay != nil {
					d := int(*stu.Departure.Delay)
					delay.DepartureDelay = &d
				}
				if stu.Departure.Time != nil {
					t := time.Unix(*stu.Departure.Time, 0).UTC()
					delay.PredictedDeparture = &t
				}
			}

			// Schedule relationship
			if stu.ScheduleRelationship != nil {
				if sr, ok := ScheduleRelationshipMap[int32(*stu.ScheduleRelationship)]; ok {
					delay.ScheduleRelationship = &sr
				}
			}

			key := DelayKey{TripID: tripID, StopID: *stu.StopId}
			delays[key] = delay
		}

		// Sort stops by sequence and store
		if len(stops) > 0 {
			sort.Slice(stops, func(i, j int) bool {
				return stops[i].StopSequence < stops[j].StopSequence
			})
			tripStopsMap[tripID] = &TripStops{Stops: stops}
		}
	}

	return delays, tripStopsMap, nil
}

// fetchFeed fetches a GTFS-RT feed from the given URL
func (p *Poller) fetchFeed(ctx context.Context, url string) (*gtfs.FeedMessage, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch feed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("feed returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	feed := &gtfs.FeedMessage{}
	if err := proto.Unmarshal(body, feed); err != nil {
		return nil, fmt.Errorf("failed to parse protobuf: %w", err)
	}

	return feed, nil
}

// extractLineCode extracts the Rodalies line code from a vehicle label
// Examples: "R4-77626-PLATF.(1)" -> "R4", "R2N-12345" -> "R2N", "RG1-xxx" -> "RG1"
func extractLineCode(label string) string {
	match := lineCodeRegex.FindString(strings.ToUpper(label))
	return match
}
