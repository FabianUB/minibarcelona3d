package models

import (
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Train represents a single active train's current state from rt_rodalies_vehicle_current
// Maps 1:1 to database table rows as defined in data-model.md
type Train struct {
	// Primary identifier
	VehicleKey string `db:"vehicle_key" json:"vehicleKey"`

	// Identity fields (nullable in DB)
	VehicleID    *string `db:"vehicle_id" json:"vehicleId"`
	VehicleLabel string  `db:"vehicle_label" json:"vehicleLabel"`
	EntityID     string  `db:"entity_id" json:"entityId"`

	// Trip context (nullable in DB)
	TripID  *string `db:"trip_id" json:"tripId"`
	RouteID *string `db:"route_id" json:"routeId"`

	// Position (nullable in DB - trains may not report GPS)
	Latitude  *float64 `db:"latitude" json:"latitude"`
	Longitude *float64 `db:"longitude" json:"longitude"`

	// Stop context (nullable in DB)
	CurrentStopID    *string `db:"current_stop_id" json:"currentStopId"`
	PreviousStopID   *string `db:"previous_stop_id" json:"previousStopId"`
	NextStopID       *string `db:"next_stop_id" json:"nextStopId"`
	NextStopSequence *int    `db:"next_stop_sequence" json:"nextStopSequence"`

	// Status
	Status string `db:"status" json:"status"` // GTFS VehicleStopStatus

	// Delay information (nullable in DB)
	ArrivalDelaySeconds   *int `db:"arrival_delay_seconds" json:"arrivalDelaySeconds"`
	DepartureDelaySeconds *int `db:"departure_delay_seconds" json:"departureDelaySeconds"`

	// Schedule relationship and predictions (nullable in DB)
	ScheduleRelationship  *string    `db:"schedule_relationship" json:"scheduleRelationship"`
	PredictedArrivalUTC   *time.Time `db:"predicted_arrival_utc" json:"predictedArrivalUtc"`
	PredictedDepartureUTC *time.Time `db:"predicted_departure_utc" json:"predictedDepartureUtc"`

	// Timestamps
	VehicleTimestampUTC *time.Time `db:"vehicle_timestamp_utc" json:"vehicleTimestampUtc"`
	PolledAtUTC         time.Time  `db:"polled_at_utc" json:"polledAtUtc"`
	UpdatedAt           time.Time  `db:"updated_at" json:"updatedAt"`

	// Metadata (not exposed to frontend initially)
	SnapshotID             uuid.UUID  `db:"snapshot_id" json:"-"`
	TripUpdateTimestampUTC *time.Time `db:"trip_update_timestamp_utc" json:"-"`
}

// Validate checks if the Train model has valid data
// Returns error if any validation fails
func (t *Train) Validate() error {
	// VehicleKey is required
	if t.VehicleKey == "" {
		return errors.New("vehicle_key is required")
	}

	// VehicleLabel must start with R (Rodalies filter)
	if !strings.HasPrefix(t.VehicleLabel, "R") {
		return errors.New("vehicle_label must start with R")
	}

	// Latitude must be in valid range [-90, 90] if present
	if t.Latitude != nil {
		if *t.Latitude < -90 || *t.Latitude > 90 {
			return errors.New("latitude out of range: must be between -90 and 90")
		}
	}

	// Longitude must be in valid range [-180, 180] if present
	if t.Longitude != nil {
		if *t.Longitude < -180 || *t.Longitude > 180 {
			return errors.New("longitude out of range: must be between -180 and 180")
		}
	}

	// RouteID is optional - some trains on platforms don't have assigned routes
	// (Previously required, but GTFS-RT feed shows trains with NULL route_id)

	// Status is required (GTFS VehicleStopStatus)
	if t.Status == "" {
		return errors.New("status is required")
	}

	return nil
}

// TrainPosition is a lightweight model for efficient polling responses
// Subset of Train for frequent position updates (Phase B)
// Used in /api/trains/positions endpoint that polls every 15-30s
type TrainPosition struct {
	VehicleKey  string    `json:"vehicleKey"`
	Latitude    *float64  `json:"latitude"`
	Longitude   *float64  `json:"longitude"`
	NextStopID  *string   `json:"nextStopId,omitempty"`
	RouteID     *string   `json:"routeId,omitempty"`
	Status      *string   `json:"status,omitempty"`
	PolledAtUTC time.Time `json:"polledAtUtc"`
}

func (t *Train) ToTrainPosition() TrainPosition {
	var status *string
	if t.Status != "" {
		status = &t.Status
	}
	return TrainPosition{
		VehicleKey:  t.VehicleKey,
		Latitude:    t.Latitude,
		Longitude:   t.Longitude,
		NextStopID:  t.NextStopID,
		RouteID:     t.RouteID,
		Status:      status,
		PolledAtUTC: t.PolledAtUTC,
	}
}

type StopTime struct {
	StopID       string  `json:"stopId"`
	StopSequence int     `json:"stopSequence"`
	StopName     *string `json:"stopName"`

	ScheduledArrival   *string `json:"scheduledArrival"`
	ScheduledDeparture *string `json:"scheduledDeparture"`

	PredictedArrivalUTC   *time.Time `json:"predictedArrivalUtc"`
	PredictedDepartureUTC *time.Time `json:"predictedDepartureUtc"`

	ArrivalDelaySeconds   *int `json:"arrivalDelaySeconds"`
	DepartureDelaySeconds *int `json:"departureDelaySeconds"`

	ScheduleRelationship *string `json:"scheduleRelationship"`
}

type TripDetails struct {
	TripID    string      `json:"tripId"`
	RouteID   string      `json:"routeId"`
	StopTimes []StopTime  `json:"stopTimes"`
	UpdatedAt *time.Time  `json:"updatedAt"`
}
