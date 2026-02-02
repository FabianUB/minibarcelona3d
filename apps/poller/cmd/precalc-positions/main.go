package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math"
	"time"

	"github.com/mini-rodalies-3d/poller/internal/db"
)

const (
	slotDurationSec = 30
	slotsPerDay     = 86400 / slotDurationSec // 2880
)

// DayType represents a schedule pattern
type DayType string

const (
	DayTypeWeekday  DayType = "weekday"  // Mon-Thu
	DayTypeFriday   DayType = "friday"   // Friday
	DayTypeSaturday DayType = "saturday" // Saturday
	DayTypeSunday   DayType = "sunday"   // Sunday (also used for holidays)
)

// Position represents a vehicle position for JSON serialization
type Position struct {
	VehicleKey       string   `json:"vehicleKey"`
	RouteID          string   `json:"routeId"`
	RouteShortName   string   `json:"routeShortName"`
	RouteLongName    string   `json:"routeLongName,omitempty"`
	RouteColor       string   `json:"routeColor"`
	TripID           string   `json:"tripId"`
	DirectionID      int      `json:"direction"`
	Latitude         float64  `json:"latitude"`
	Longitude        float64  `json:"longitude"`
	Bearing          *float64 `json:"bearing,omitempty"`
	PrevStopID       string   `json:"prevStopId,omitempty"`
	NextStopID       string   `json:"nextStopId,omitempty"`
	PrevStopName     string   `json:"prevStopName,omitempty"`
	NextStopName     string   `json:"nextStopName,omitempty"`
	ProgressFraction float64  `json:"progressFraction"`
	ScheduledArrival string   `json:"scheduledArrival,omitempty"`
}

// TripInfo contains trip metadata
type TripInfo struct {
	TripID       string
	RouteID      string
	ServiceID    string
	TripHeadsign string
	DirectionID  int
}

// StopTime represents a stop time entry
type StopTime struct {
	StopID           string
	StopSequence     int
	ArrivalSeconds   int
	DepartureSeconds int
	StopName         string
	StopLat          float64
	StopLon          float64
}

// RouteInfo contains route metadata
type RouteInfo struct {
	RouteShortName string
	RouteLongName  string
	RouteColor     string
}

func main() {
	dbPath := flag.String("db", "../../data/transit.db", "Path to SQLite database")
	flag.Parse()

	database, err := db.Connect(*dbPath)
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}
	defer database.Close()

	ctx := context.Background()

	// Ensure schema exists (will recreate table with new schema)
	if err := database.EnsureSchema(ctx); err != nil {
		log.Fatalf("Failed to ensure schema: %v", err)
	}

	// Clear existing pre-calculated data
	if _, err := database.Conn().ExecContext(ctx, "DELETE FROM pre_schedule_positions"); err != nil {
		log.Printf("Warning: failed to clear existing data: %v", err)
	}

	// Get all networks
	networks, err := getNetworks(ctx, database)
	if err != nil {
		log.Fatalf("Failed to get networks: %v", err)
	}

	log.Printf("Found %d networks: %v", len(networks), networks)

	// Load route info once
	routeInfo, err := loadRouteInfo(ctx, database)
	if err != nil {
		log.Fatalf("Failed to load route info: %v", err)
	}

	// Process each network
	for _, network := range networks {
		log.Printf("\nProcessing network: %s", network)

		// Find representative dates for each day type
		dayTypeDates, err := findRepresentativeDates(ctx, database, network)
		if err != nil {
			log.Printf("  ERROR finding dates: %v", err)
			continue
		}

		for dayType, dateStr := range dayTypeDates {
			if err := processNetworkDayType(ctx, database, network, dayType, dateStr, routeInfo); err != nil {
				log.Printf("  ERROR processing %s/%s: %v", network, dayType, err)
			}
		}
	}

	log.Println("\nPre-calculation complete!")
}

func getNetworks(ctx context.Context, database *db.DB) ([]string, error) {
	query := `SELECT DISTINCT network FROM dim_calendar_dates WHERE exception_type = 1 ORDER BY network`

	rows, err := database.Conn().QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var networks []string
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			return nil, err
		}
		networks = append(networks, n)
	}
	return networks, rows.Err()
}

// findRepresentativeDates finds a representative date for each day type
func findRepresentativeDates(ctx context.Context, database *db.DB, network string) (map[DayType]string, error) {
	// Query all available dates with their day of week
	query := `
		SELECT DISTINCT
			cd.date,
			CAST(strftime('%w', substr(cd.date,1,4) || '-' || substr(cd.date,5,2) || '-' || substr(cd.date,7,2)) AS INTEGER) as dow
		FROM dim_calendar_dates cd
		WHERE cd.network = ? AND cd.exception_type = 1
		ORDER BY cd.date
	`

	rows, err := database.Conn().QueryContext(ctx, query, network)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// Group dates by day type
	dayTypeDates := make(map[DayType][]string)

	for rows.Next() {
		var dateStr string
		var dow int
		if err := rows.Scan(&dateStr, &dow); err != nil {
			return nil, err
		}

		// Map day of week to day type
		// dow: 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday
		var dayType DayType
		switch dow {
		case 0:
			dayType = DayTypeSunday
		case 1, 2, 3, 4:
			dayType = DayTypeWeekday
		case 5:
			dayType = DayTypeFriday
		case 6:
			dayType = DayTypeSaturday
		}

		dayTypeDates[dayType] = append(dayTypeDates[dayType], dateStr)
	}

	// Pick a recent date for each day type (prefer dates from 2026 or late 2025)
	result := make(map[DayType]string)
	for dayType, dates := range dayTypeDates {
		if len(dates) > 0 {
			// Find the first date >= 20260101, or the last available date
			selectedDate := dates[len(dates)-1] // Default to most recent
			for _, d := range dates {
				if d >= "20260101" {
					selectedDate = d
					break
				}
			}
			result[dayType] = selectedDate
			log.Printf("  %s: using date %s (from %d available)", dayType, result[dayType], len(dates))
		}
	}

	return result, rows.Err()
}

func loadRouteInfo(ctx context.Context, database *db.DB) (map[string]RouteInfo, error) {
	query := `SELECT route_id, route_short_name, COALESCE(route_long_name, ''), COALESCE(route_color, '') FROM dim_routes`

	rows, err := database.Conn().QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	routes := make(map[string]RouteInfo)
	for rows.Next() {
		var routeID, shortName, longName, color string
		if err := rows.Scan(&routeID, &shortName, &longName, &color); err != nil {
			return nil, err
		}
		routes[routeID] = RouteInfo{RouteShortName: shortName, RouteLongName: longName, RouteColor: color}
	}

	return routes, rows.Err()
}

func processNetworkDayType(ctx context.Context, database *db.DB, network string, dayType DayType, dateStr string, routeInfo map[string]RouteInfo) error {
	startTime := time.Now()

	// Load all trips active on this date
	trips, err := loadActiveTrips(ctx, database, network, dateStr)
	if err != nil {
		return fmt.Errorf("failed to load trips: %w", err)
	}

	if len(trips) == 0 {
		log.Printf("  %s: No active trips", dayType)
		return nil
	}

	// Load stop times for all trips
	tripStopTimes := make(map[string][]StopTime)
	for _, trip := range trips {
		stopTimes, err := loadTripStopTimes(ctx, database, network, trip.TripID)
		if err != nil {
			return fmt.Errorf("failed to load stop times for trip %s: %w", trip.TripID, err)
		}
		if len(stopTimes) >= 2 {
			tripStopTimes[trip.TripID] = stopTimes
		}
	}

	// Find operating hours
	minSlot, maxSlot := findOperatingSlots(tripStopTimes)

	// Prepare insert statement
	insertStmt, err := database.Conn().PrepareContext(ctx, `
		INSERT OR REPLACE INTO pre_schedule_positions (network, day_type, time_slot, positions_json, vehicle_count)
		VALUES (?, ?, ?, ?, ?)
	`)
	if err != nil {
		return fmt.Errorf("failed to prepare insert: %w", err)
	}
	defer insertStmt.Close()

	// Map network to display type
	displayNetwork := network
	if network == "tram_tbs" || network == "tram_tbx" {
		displayNetwork = "tram"
	}

	insertCount := 0
	totalVehicles := 0

	for slot := minSlot; slot <= maxSlot; slot++ {
		secondsSinceMidnight := slot * slotDurationSec

		var positions []Position

		for _, trip := range trips {
			stopTimes, ok := tripStopTimes[trip.TripID]
			if !ok {
				continue
			}

			pos := calculatePositionAtTime(trip, stopTimes, secondsSinceMidnight, routeInfo, displayNetwork)
			if pos != nil {
				positions = append(positions, *pos)
			}
		}

		if len(positions) > 0 {
			posJSON, err := json.Marshal(positions)
			if err != nil {
				return fmt.Errorf("failed to marshal positions: %w", err)
			}

			if _, err := insertStmt.ExecContext(ctx, network, string(dayType), slot, string(posJSON), len(positions)); err != nil {
				return fmt.Errorf("failed to insert slot %d: %w", slot, err)
			}

			insertCount++
			totalVehicles += len(positions)
		}
	}

	elapsed := time.Since(startTime)
	avgVehicles := 0
	if insertCount > 0 {
		avgVehicles = totalVehicles / insertCount
	}

	log.Printf("  %s: %d trips, %d slots, avg %d vehicles/slot (%v)",
		dayType, len(trips), insertCount, avgVehicles, elapsed.Round(time.Millisecond))

	return nil
}

func loadActiveTrips(ctx context.Context, database *db.DB, network, dateStr string) ([]TripInfo, error) {
	query := `
		SELECT t.trip_id, t.route_id, t.service_id, COALESCE(t.trip_headsign, ''), t.direction_id
		FROM dim_trips t
		JOIN dim_calendar_dates cd ON cd.service_id = t.service_id AND cd.network = t.network
		WHERE cd.date = ? AND cd.exception_type = 1 AND cd.network = ?
	`

	rows, err := database.Conn().QueryContext(ctx, query, dateStr, network)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var trips []TripInfo
	for rows.Next() {
		var t TripInfo
		if err := rows.Scan(&t.TripID, &t.RouteID, &t.ServiceID, &t.TripHeadsign, &t.DirectionID); err != nil {
			return nil, err
		}
		trips = append(trips, t)
	}

	return trips, rows.Err()
}

func loadTripStopTimes(ctx context.Context, database *db.DB, network, tripID string) ([]StopTime, error) {
	query := `
		SELECT st.stop_id, st.stop_sequence, st.arrival_seconds, st.departure_seconds,
		       COALESCE(s.stop_name, ''), COALESCE(s.stop_lat, 0), COALESCE(s.stop_lon, 0)
		FROM dim_stop_times st
		LEFT JOIN dim_stops s ON s.stop_id = st.stop_id
		WHERE st.trip_id = ? AND st.network = ?
		ORDER BY st.stop_sequence
	`

	rows, err := database.Conn().QueryContext(ctx, query, tripID, network)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var stops []StopTime
	for rows.Next() {
		var st StopTime
		if err := rows.Scan(&st.StopID, &st.StopSequence, &st.ArrivalSeconds, &st.DepartureSeconds,
			&st.StopName, &st.StopLat, &st.StopLon); err != nil {
			return nil, err
		}
		stops = append(stops, st)
	}

	return stops, rows.Err()
}

func findOperatingSlots(tripStopTimes map[string][]StopTime) (int, int) {
	minSec := 86400
	maxSec := 0

	for _, stops := range tripStopTimes {
		if len(stops) == 0 {
			continue
		}
		if stops[0].DepartureSeconds < minSec {
			minSec = stops[0].DepartureSeconds
		}
		lastStop := stops[len(stops)-1]
		if lastStop.ArrivalSeconds > maxSec {
			maxSec = lastStop.ArrivalSeconds
		}
	}

	minSlot := (minSec / slotDurationSec) - 1
	if minSlot < 0 {
		minSlot = 0
	}
	maxSlot := (maxSec / slotDurationSec) + 1
	if maxSlot >= slotsPerDay {
		maxSlot = slotsPerDay - 1
	}

	return minSlot, maxSlot
}

func calculatePositionAtTime(trip TripInfo, stopTimes []StopTime, currentSeconds int, routeInfo map[string]RouteInfo, displayNetwork string) *Position {
	firstDeparture := stopTimes[0].DepartureSeconds
	lastArrival := stopTimes[len(stopTimes)-1].ArrivalSeconds

	if currentSeconds < firstDeparture || currentSeconds > lastArrival {
		return nil
	}

	var prevStop, nextStop *StopTime
	for i := 0; i < len(stopTimes)-1; i++ {
		curr := &stopTimes[i]
		next := &stopTimes[i+1]

		if currentSeconds >= curr.DepartureSeconds && currentSeconds <= next.ArrivalSeconds {
			prevStop = curr
			nextStop = next
			break
		}
	}

	if prevStop == nil || nextStop == nil {
		return nil
	}

	if prevStop.StopLat == 0 || nextStop.StopLat == 0 {
		return nil
	}

	segmentDuration := nextStop.ArrivalSeconds - prevStop.DepartureSeconds
	if segmentDuration <= 0 {
		segmentDuration = 1
	}

	elapsed := currentSeconds - prevStop.DepartureSeconds
	segmentFraction := float64(elapsed) / float64(segmentDuration)
	if segmentFraction < 0 {
		segmentFraction = 0
	}
	if segmentFraction > 1 {
		segmentFraction = 1
	}

	lat := prevStop.StopLat + (nextStop.StopLat-prevStop.StopLat)*segmentFraction
	lon := prevStop.StopLon + (nextStop.StopLon-prevStop.StopLon)*segmentFraction

	bearing := calculateBearing(prevStop.StopLat, prevStop.StopLon, nextStop.StopLat, nextStop.StopLon)

	// Calculate progress fraction along the ENTIRE route (not just current segment)
	// This is used by the frontend to position vehicles along the line geometry
	totalDuration := lastArrival - firstDeparture
	if totalDuration <= 0 {
		totalDuration = 1
	}
	elapsedFromStart := currentSeconds - firstDeparture
	progressFraction := float64(elapsedFromStart) / float64(totalDuration)
	if progressFraction < 0 {
		progressFraction = 0
	}
	if progressFraction > 1 {
		progressFraction = 1
	}

	route := routeInfo[trip.RouteID]

	return &Position{
		VehicleKey:       fmt.Sprintf("%s-%s", displayNetwork, trip.TripID),
		RouteID:          trip.RouteID,
		RouteShortName:   route.RouteShortName,
		RouteLongName:    route.RouteLongName,
		RouteColor:       route.RouteColor,
		TripID:           trip.TripID,
		DirectionID:      trip.DirectionID,
		Latitude:         lat,
		Longitude:        lon,
		Bearing:          &bearing,
		PrevStopID:       prevStop.StopID,
		NextStopID:       nextStop.StopID,
		PrevStopName:     prevStop.StopName,
		NextStopName:     nextStop.StopName,
		ProgressFraction: progressFraction,
		ScheduledArrival: formatTimeOfDay(nextStop.ArrivalSeconds),
	}
}

func calculateBearing(lat1, lon1, lat2, lon2 float64) float64 {
	lat1Rad := lat1 * math.Pi / 180
	lat2Rad := lat2 * math.Pi / 180
	dLon := (lon2 - lon1) * math.Pi / 180

	y := math.Sin(dLon) * math.Cos(lat2Rad)
	x := math.Cos(lat1Rad)*math.Sin(lat2Rad) - math.Sin(lat1Rad)*math.Cos(lat2Rad)*math.Cos(dLon)

	bearing := math.Atan2(y, x) * 180 / math.Pi
	return math.Mod(bearing+360, 360)
}

func formatTimeOfDay(seconds int) string {
	hours := seconds / 3600
	minutes := (seconds % 3600) / 60
	return fmt.Sprintf("%02d:%02d", hours%24, minutes)
}
