package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"math"
	"time"

	"github.com/mini-rodalies-3d/poller/internal/db"
)

// Barcelona timezone
var barcelonaTZ *time.Location

func init() {
	var err error
	barcelonaTZ, err = time.LoadLocation("Europe/Madrid")
	if err != nil {
		log.Fatalf("Failed to load Barcelona timezone: %v", err)
	}
}

// ActiveTrip represents a trip that's currently active
type ActiveTrip struct {
	TripID       string
	Network      string
	RouteID      string
	ServiceID    string
	TripHeadsign string
	DirectionID  int
}

// TripStopTime represents a stop time for a trip
type TripStopTime struct {
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

	// Get current time in Barcelona
	now := time.Now().In(barcelonaTZ)
	dateStr := now.Format("20060102")
	secondsSinceMidnight := now.Hour()*3600 + now.Minute()*60 + now.Second()

	log.Printf("Barcelona time: %s (%d seconds since midnight)", now.Format("2006-01-02 15:04:05"), secondsSinceMidnight)
	log.Printf("Date: %s", dateStr)

	// Find active trips for today
	activeTrips, err := getActiveTrips(ctx, database, dateStr)
	if err != nil {
		log.Fatalf("Failed to get active trips: %v", err)
	}
	log.Printf("Found %d active trips for today", len(activeTrips))

	// Get route info for all networks
	routeInfo, err := getRouteInfo(ctx, database)
	if err != nil {
		log.Fatalf("Failed to get route info: %v", err)
	}

	// Calculate positions for trips in progress
	positions := []db.SchedulePosition{}
	inProgressCount := 0

	for _, trip := range activeTrips {
		stopTimes, err := getTripStopTimes(ctx, database, trip.Network, trip.TripID)
		if err != nil {
			log.Printf("Warning: failed to get stop times for trip %s: %v", trip.TripID, err)
			continue
		}

		if len(stopTimes) < 2 {
			continue
		}

		// Check if trip is in progress
		firstDeparture := stopTimes[0].DepartureSeconds
		lastArrival := stopTimes[len(stopTimes)-1].ArrivalSeconds

		if secondsSinceMidnight < firstDeparture || secondsSinceMidnight > lastArrival {
			continue
		}

		inProgressCount++

		// Find current segment
		pos := calculatePosition(trip, stopTimes, secondsSinceMidnight, routeInfo)
		if pos != nil {
			positions = append(positions, *pos)
		}
	}

	log.Printf("Trips in progress: %d, positions calculated: %d", inProgressCount, len(positions))

	// Insert positions into database
	if len(positions) > 0 {
		snapshotID := fmt.Sprintf("schedule-%s", now.Format("20060102-150405"))
		if err := database.UpsertSchedulePositions(ctx, snapshotID, now, positions); err != nil {
			log.Fatalf("Failed to insert positions: %v", err)
		}
		log.Printf("Inserted %d positions with snapshot_id %s", len(positions), snapshotID)
	}

	// Print summary by network
	networkCounts := make(map[string]int)
	for _, p := range positions {
		networkCounts[p.NetworkType]++
	}
	for network, count := range networkCounts {
		log.Printf("  %s: %d vehicles", network, count)
	}
}

func getActiveTrips(ctx context.Context, database *db.DB, dateStr string) ([]ActiveTrip, error) {
	query := `
		SELECT t.trip_id, t.network, t.route_id, t.service_id, t.trip_headsign, t.direction_id
		FROM dim_trips t
		JOIN dim_calendar_dates cd ON cd.service_id = t.service_id AND cd.network = t.network
		WHERE cd.date = ? AND cd.exception_type = 1
	`

	rows, err := database.Conn().QueryContext(ctx, query, dateStr)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var trips []ActiveTrip
	for rows.Next() {
		var t ActiveTrip
		if err := rows.Scan(&t.TripID, &t.Network, &t.RouteID, &t.ServiceID, &t.TripHeadsign, &t.DirectionID); err != nil {
			return nil, err
		}
		trips = append(trips, t)
	}

	return trips, rows.Err()
}

func getTripStopTimes(ctx context.Context, database *db.DB, network, tripID string) ([]TripStopTime, error) {
	query := `
		SELECT st.stop_id, st.stop_sequence, st.arrival_seconds, st.departure_seconds,
		       s.stop_name, s.stop_lat, s.stop_lon
		FROM dim_stop_times st
		JOIN dim_stops s ON s.stop_id = st.stop_id
		WHERE st.trip_id = ? AND st.network = ?
		ORDER BY st.stop_sequence
	`

	rows, err := database.Conn().QueryContext(ctx, query, tripID, network)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var stops []TripStopTime
	for rows.Next() {
		var st TripStopTime
		if err := rows.Scan(&st.StopID, &st.StopSequence, &st.ArrivalSeconds, &st.DepartureSeconds,
			&st.StopName, &st.StopLat, &st.StopLon); err != nil {
			return nil, err
		}
		stops = append(stops, st)
	}

	return stops, rows.Err()
}

func getRouteInfo(ctx context.Context, database *db.DB) (map[string]RouteInfo, error) {
	query := `SELECT route_id, route_short_name, route_color FROM dim_routes`

	rows, err := database.Conn().QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	routes := make(map[string]RouteInfo)
	for rows.Next() {
		var routeID, shortName, color string
		if err := rows.Scan(&routeID, &shortName, &color); err != nil {
			return nil, err
		}
		routes[routeID] = RouteInfo{RouteShortName: shortName, RouteColor: color}
	}

	return routes, rows.Err()
}

func calculatePosition(trip ActiveTrip, stopTimes []TripStopTime, currentSeconds int, routeInfo map[string]RouteInfo) *db.SchedulePosition {
	// Find the segment we're in
	var prevStop, nextStop *TripStopTime
	for i := 0; i < len(stopTimes)-1; i++ {
		curr := &stopTimes[i]
		next := &stopTimes[i+1]

		// Check if we're between departure of curr and arrival at next
		if currentSeconds >= curr.DepartureSeconds && currentSeconds <= next.ArrivalSeconds {
			prevStop = curr
			nextStop = next
			break
		}
	}

	if prevStop == nil || nextStop == nil {
		return nil
	}

	// Calculate progress fraction within this segment
	segmentDuration := nextStop.ArrivalSeconds - prevStop.DepartureSeconds
	if segmentDuration <= 0 {
		segmentDuration = 1 // Avoid division by zero
	}

	elapsed := currentSeconds - prevStop.DepartureSeconds
	fraction := float64(elapsed) / float64(segmentDuration)
	if fraction < 0 {
		fraction = 0
	}
	if fraction > 1 {
		fraction = 1
	}

	// Interpolate position
	lat := prevStop.StopLat + (nextStop.StopLat-prevStop.StopLat)*fraction
	lon := prevStop.StopLon + (nextStop.StopLon-prevStop.StopLon)*fraction

	// Calculate bearing
	bearing := calculateBearing(prevStop.StopLat, prevStop.StopLon, nextStop.StopLat, nextStop.StopLon)

	// Get route info
	route := routeInfo[trip.RouteID]

	// Format arrival time
	arrivalStr := formatTimeOfDay(nextStop.ArrivalSeconds)
	departureStr := formatTimeOfDay(prevStop.DepartureSeconds)

	// Map network to display type
	networkType := trip.Network
	if networkType == "tram_tbs" || networkType == "tram_tbx" {
		networkType = "tram"
	}

	return &db.SchedulePosition{
		VehicleKey:         fmt.Sprintf("%s-%s", networkType, trip.TripID),
		NetworkType:        networkType,
		RouteID:            trip.RouteID,
		RouteShortName:     route.RouteShortName,
		RouteColor:         route.RouteColor,
		TripID:             trip.TripID,
		DirectionID:        trip.DirectionID,
		Latitude:           lat,
		Longitude:          lon,
		Bearing:            &bearing,
		PreviousStopID:     &prevStop.StopID,
		NextStopID:         &nextStop.StopID,
		PreviousStopName:   &prevStop.StopName,
		NextStopName:       &nextStop.StopName,
		Status:             "IN_TRANSIT_TO",
		ProgressFraction:   fraction,
		ScheduledArrival:   &arrivalStr,
		ScheduledDeparture: &departureStr,
		Source:             "schedule",
		Confidence:         "low",
		EstimatedAt:        time.Now(),
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
	return fmt.Sprintf("%02d:%02d", hours, minutes)
}
