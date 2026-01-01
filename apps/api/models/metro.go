package models

import (
	"time"

	"github.com/google/uuid"
)

// MetroPosition represents a Metro vehicle's estimated position from rt_metro_vehicle_current
// Designed to match the frontend VehiclePosition type for seamless integration
type MetroPosition struct {
	// Primary identifier
	VehicleKey string `json:"vehicleKey"` // "metro-L1-0-3" format

	// Network type (always "metro" for this model)
	NetworkType string `json:"networkType"` // Always "metro"

	// Line context
	LineCode    string  `json:"lineCode"`          // "L1", "L3", etc.
	RouteID     *string `json:"routeId,omitempty"` // TMB route_id if available
	DirectionID int     `json:"direction"`         // 0 = outbound, 1 = inbound

	// Position (estimated from arrival times + line geometry)
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
	ProgressFraction   *float64 `json:"progressFraction,omitempty"`   // 0.0-1.0 between stops
	DistanceAlongLine  *float64 `json:"distanceAlongLine,omitempty"`  // Meters from line start
	SpeedMetersPerSec  *float64 `json:"speedMetersPerSecond,omitempty"`
	LineTotalLength    *float64 `json:"lineTotalLength,omitempty"`

	// Confidence and source
	Source     string `json:"source"`     // "imetro" or "schedule_fallback"
	Confidence string `json:"confidence"` // "high", "medium", "low"

	// Arrival timing (from iMetro API)
	ArrivalSecondsToNext *int `json:"arrivalMinutes,omitempty"` // Seconds until next stop

	// Visual
	LineColor string `json:"lineColor"` // Hex color for the line

	// Timestamps
	EstimatedAtUTC time.Time `json:"estimatedAt"`
	PolledAtUTC    time.Time `json:"polledAtUtc"`

	// Metadata (not exposed to frontend)
	SnapshotID uuid.UUID `json:"-"`
}

// MetroArrival represents a raw arrival prediction from iMetro API stored in rt_metro_arrivals_current
type MetroArrival struct {
	ArrivalKey string `json:"arrivalKey"`

	// Line and station context
	LineCode    string `json:"lineCode"`
	StopID      string `json:"stopId"`
	StopCode    string `json:"stopCode,omitempty"`
	DirectionID int    `json:"directionId"`

	// Arrival prediction
	ArrivalSeconds       int        `json:"arrivalSeconds"`
	ArrivalTimestampUTC  *time.Time `json:"arrivalTimestampUtc,omitempty"`

	// Vehicle inference
	VehicleSequence *int    `json:"vehicleSequence,omitempty"`
	DestinationName *string `json:"destinationName,omitempty"`

	// Timestamps
	PolledAtUTC time.Time `json:"polledAtUtc"`

	// Metadata
	SnapshotID uuid.UUID `json:"-"`
}

// Metro line colors (TMB official colors)
var MetroLineColors = map[string]string{
	"L1":   "#E2001A", // Red
	"L2":   "#9B2B93", // Purple
	"L3":   "#00A651", // Green
	"L4":   "#FFDD00", // Yellow
	"L5":   "#0065A4", // Blue
	"L9N":  "#F58220", // Orange
	"L9S":  "#F58220", // Orange
	"L10N": "#00ADEF", // Light blue
	"L10S": "#00ADEF", // Light blue
	"L11":  "#8BC53F", // Light green
}

// GetLineColor returns the official TMB color for a Metro line
func GetLineColor(lineCode string) string {
	if color, ok := MetroLineColors[lineCode]; ok {
		return color
	}
	return "#888888" // Default gray for unknown lines
}
