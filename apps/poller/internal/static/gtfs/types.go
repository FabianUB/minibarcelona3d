package gtfs

// Data represents all parsed GTFS data
type Data struct {
	Routes   []Route
	Stops    []Stop
	Trips    []Trip
	Shapes   map[string][]ShapePoint // keyed by shape_id
	StopTimes []StopTime
	Agency   []Agency
}

// Route represents a route from routes.txt
type Route struct {
	RouteID        string
	AgencyID       string
	RouteShortName string
	RouteLongName  string
	RouteType      int
	RouteColor     string
	RouteTextColor string
}

// Stop represents a stop from stops.txt
type Stop struct {
	StopID       string
	StopCode     string
	StopName     string
	StopLat      float64
	StopLon      float64
	LocationType int
	ParentStation string
}

// Trip represents a trip from trips.txt
type Trip struct {
	RouteID      string
	ServiceID    string
	TripID       string
	TripHeadsign string
	DirectionID  int
	ShapeID      string
}

// ShapePoint represents a point from shapes.txt
type ShapePoint struct {
	ShapeID           string
	ShapePtLat        float64
	ShapePtLon        float64
	ShapePtSequence   int
	ShapeDistTraveled float64
}

// StopTime represents a stop time from stop_times.txt
type StopTime struct {
	TripID        string
	ArrivalTime   string
	DepartureTime string
	StopID        string
	StopSequence  int
}

// Agency represents an agency from agency.txt
type Agency struct {
	AgencyID   string
	AgencyName string
	AgencyURL  string
}
