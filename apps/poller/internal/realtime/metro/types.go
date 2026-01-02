package metro

// TrainArrival represents a parsed arrival from iMetro API
type TrainArrival struct {
	TrainID       string
	LineCode      string
	Direction     int
	StationCode   string
	SecondsToNext int
	Destination   string
	RouteCode     string
	Occupancy     *int
}

// Station represents a metro station from GeoJSON
type Station struct {
	StopID    string
	StopCode  string
	Name      string
	Latitude  float64
	Longitude float64
	Lines     []string
}

// LineGeometry represents a metro line's shape
type LineGeometry struct {
	LineCode    string
	Coordinates [][2]float64 // [lng, lat] pairs
	TotalLength float64      // meters
}

// EstimatedPosition represents an estimated train position
type EstimatedPosition struct {
	VehicleKey           string
	LineCode             string
	RouteID              *string
	DirectionID          int
	Latitude             float64
	Longitude            float64
	Bearing              *float64
	PreviousStopID       *string
	NextStopID           *string
	PreviousStopName     *string
	NextStopName         *string
	Status               string
	ProgressFraction     float64
	DistanceAlongLine    float64
	EstimatedSpeedMPS    float64
	LineTotalLength      float64
	Source               string
	Confidence           string
	ArrivalSecondsToNext int
}

// LineCodeMap maps numeric line codes to string codes
var LineCodeMap = map[int]string{
	1:  "L1",
	2:  "L2",
	3:  "L3",
	4:  "L4",
	5:  "L5",
	9:  "L9",
	10: "L10",
	11: "L11",
}
