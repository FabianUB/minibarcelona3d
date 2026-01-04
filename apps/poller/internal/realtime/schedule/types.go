package schedule

import "time"

// EstimatedPosition represents a schedule-estimated vehicle position
type EstimatedPosition struct {
	VehicleKey         string
	NetworkType        string // "tram", "fgc", "bus"
	RouteID            string
	RouteShortName     string
	RouteColor         string
	TripID             string
	DirectionID        int
	Latitude           float64
	Longitude          float64
	Bearing            *float64
	PreviousStopID     *string
	NextStopID         *string
	PreviousStopName   *string
	NextStopName       *string
	Status             string // IN_TRANSIT_TO, ARRIVING, STOPPED_AT
	ProgressFraction   float64
	ScheduledArrival   *string // HH:MM:SS at next stop
	ScheduledDeparture *string // HH:MM:SS from prev stop
	Source             string  // always "schedule"
	Confidence         string  // always "low"
	EstimatedAt        time.Time
}

// ActiveTrip represents a trip currently in progress
type ActiveTrip struct {
	TripID         string
	RouteID        string
	ServiceID      string
	DirectionID    int
	TripHeadsign   string
	RouteShortName string
	RouteColor     string
	RouteType      int
	FirstDeparture int // seconds since midnight
	LastArrival    int // seconds since midnight
	NetworkType    string
}

// TripStopTime represents a stop time for a trip
type TripStopTime struct {
	TripID           string
	StopID           string
	StopName         string
	StopLat          float64
	StopLon          float64
	StopSequence     int
	ArrivalSeconds   int
	DepartureSeconds int
}

// RouteGeometry represents a route's shape for position interpolation
type RouteGeometry struct {
	RouteID     string
	Coordinates [][2]float64       // [lng, lat] pairs
	TotalLength float64            // meters
	StopIndices map[string]int     // stopID -> nearest coordinate index
	StopCoords  map[string][2]float64 // stopID -> [lng, lat]
}

// NetworkType constants
const (
	NetworkTram = "tram"
	NetworkFGC  = "fgc"
	NetworkBus  = "bus"
)

// GTFS route_type values
const (
	RouteTypeTram       = 0 // Tram, Streetcar, Light rail
	RouteTypeSubway     = 1 // Subway, Metro
	RouteTypeRail       = 2 // Rail (commuter rail)
	RouteTypeBus        = 3 // Bus
	RouteTypeFerry      = 4 // Ferry
	RouteTypeCableTram  = 5 // Cable tram
	RouteTypeSuspended  = 6 // Aerial lift, suspended cable car
	RouteTypeFunicular  = 7 // Funicular
	RouteTypeTrolleybus = 11 // Trolleybus
	RouteTypeMonorail   = 12 // Monorail
)

// MadridTimezone is the timezone for Barcelona/Spain
const MadridTimezone = "Europe/Madrid"
