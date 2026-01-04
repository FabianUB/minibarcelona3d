package models

import (
	"time"

	"github.com/google/uuid"
)

// SchedulePosition represents a schedule-estimated vehicle position from rt_schedule_vehicle_current
// Used for TRAM, FGC, and Bus networks that don't have real-time feeds
type SchedulePosition struct {
	// Primary identifier
	VehicleKey string `json:"vehicleKey"` // "tram-T1-trip123" format

	// Network context
	NetworkType    string `json:"networkType"`         // "tram", "fgc", "bus"
	RouteID        string `json:"routeId"`             // GTFS route_id
	RouteShortName string `json:"routeShortName"`      // "T1", "L6", "H8"
	RouteColor     string `json:"routeColor"`          // Hex color for the line
	TripID         string `json:"tripId"`              // GTFS trip_id
	DirectionID    int    `json:"direction"`           // 0 = outbound, 1 = inbound

	// Position (estimated from schedule + stop geometry)
	Latitude  float64  `json:"latitude"`
	Longitude float64  `json:"longitude"`
	Bearing   *float64 `json:"bearing,omitempty"` // Direction in degrees (0-360)

	// Transit context
	PreviousStopID   *string `json:"previousStopId,omitempty"`
	NextStopID       *string `json:"nextStopId,omitempty"`
	PreviousStopName *string `json:"previousStopName,omitempty"`
	NextStopName     *string `json:"nextStopName,omitempty"`
	Status           string  `json:"status"` // 'IN_TRANSIT_TO', 'ARRIVING', 'STOPPED_AT'

	// Position estimation metrics
	ProgressFraction *float64 `json:"progressFraction,omitempty"` // 0.0-1.0 between stops

	// Schedule timing
	ScheduledArrival   *string `json:"scheduledArrival,omitempty"`   // HH:MM:SS at next stop
	ScheduledDeparture *string `json:"scheduledDeparture,omitempty"` // HH:MM:SS from prev stop

	// Confidence and source
	Source     string `json:"source"`     // Always "schedule"
	Confidence string `json:"confidence"` // Always "low"

	// Timestamps
	EstimatedAtUTC time.Time `json:"estimatedAt"`
	PolledAtUTC    time.Time `json:"polledAtUtc"`

	// Metadata (not exposed to frontend)
	SnapshotID uuid.UUID `json:"-"`
}

// NetworkCounts represents the count of vehicles by network type
type NetworkCounts struct {
	Tram int `json:"tram"`
	FGC  int `json:"fgc"`
	Bus  int `json:"bus"`
}
