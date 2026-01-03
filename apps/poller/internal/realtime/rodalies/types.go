package rodalies

import "time"

// VehiclePosition represents a parsed vehicle position from GTFS-RT
type VehiclePosition struct {
	VehicleKey     string
	VehicleID      *string
	EntityID       string
	VehicleLabel   string
	TripID         *string
	RouteID        *string
	CurrentStopID  *string
	PreviousStopID *string
	NextStopID     *string
	NextStopSeq    *int
	Status         string
	Latitude       *float64
	Longitude      *float64
	Timestamp      *time.Time
}

// TripDelay represents delay information from a TripUpdate
type TripDelay struct {
	TripID               string
	StopID               string
	ArrivalDelay         *int
	DepartureDelay       *int
	ScheduleRelationship *string
	PredictedArrival     *time.Time
	PredictedDeparture   *time.Time
}

// DelayKey is used to look up delays by (trip_id, stop_id)
type DelayKey struct {
	TripID string
	StopID string
}

// StatusMap maps GTFS-RT VehicleStopStatus enum to string
var StatusMap = map[int32]string{
	0: "INCOMING_AT",
	1: "STOPPED_AT",
	2: "IN_TRANSIT_TO",
}

// ScheduleRelationshipMap maps GTFS-RT ScheduleRelationship enum to string
var ScheduleRelationshipMap = map[int32]string{
	0: "SCHEDULED",
	1: "ADDED",
	2: "UNSCHEDULED",
	3: "CANCELED",
}

// TripStop represents a single stop in a trip's sequence
type TripStop struct {
	StopID       string
	StopSequence int
}

// TripStops holds an ordered list of stops for a trip
type TripStops struct {
	Stops []TripStop // Sorted by StopSequence
}
