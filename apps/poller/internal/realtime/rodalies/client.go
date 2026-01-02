package rodalies

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
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
	delays, err := p.fetchTripUpdates(ctx)
	if err != nil {
		// Non-fatal: continue without delay info
		log.Printf("Rodalies: failed to fetch trip updates (continuing without delays): %v", err)
		delays = make(map[DelayKey]TripDelay)
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

		// Look up delay info
		if pos.TripID != nil && pos.CurrentStopID != nil {
			key := DelayKey{TripID: *pos.TripID, StopID: *pos.CurrentStopID}
			if delay, ok := delays[key]; ok {
				dbPos.ArrivalDelaySeconds = delay.ArrivalDelay
				dbPos.DepartureDelaySeconds = delay.DepartureDelay
				dbPos.ScheduleRelationship = delay.ScheduleRelationship
				dbPos.PredictedArrival = delay.PredictedArrival
				dbPos.PredictedDeparture = delay.PredictedDeparture
			}
		}

		dbPositions = append(dbPositions, dbPos)
	}

	// Write to database
	if err := p.db.UpsertRodaliesPositions(ctx, snapshotID, polledAt, dbPositions); err != nil {
		return fmt.Errorf("failed to write positions: %w", err)
	}

	log.Printf("Rodalies: polled %d vehicles", len(dbPositions))
	return nil
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

		// Stop info
		if vehicle.CurrentStopSequence != nil {
			seq := int(*vehicle.CurrentStopSequence)
			pos.NextStopSeq = &seq
		}
		pos.CurrentStopID = vehicle.StopId

		// Status
		if vehicle.CurrentStatus != nil {
			if status, ok := StatusMap[int32(*vehicle.CurrentStatus)]; ok {
				pos.Status = status
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
func (p *Poller) fetchTripUpdates(ctx context.Context) (map[DelayKey]TripDelay, error) {
	feed, err := p.fetchFeed(ctx, p.cfg.GTFSTripUpdatesURL)
	if err != nil {
		return nil, err
	}

	delays := make(map[DelayKey]TripDelay)
	for _, entity := range feed.Entity {
		if entity.TripUpdate == nil {
			continue
		}

		tripUpdate := entity.TripUpdate
		if tripUpdate.Trip == nil || tripUpdate.Trip.TripId == nil {
			continue
		}

		tripID := *tripUpdate.Trip.TripId

		for _, stu := range tripUpdate.StopTimeUpdate {
			if stu.StopId == nil {
				continue
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
	}

	return delays, nil
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
