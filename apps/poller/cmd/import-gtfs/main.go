package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/mini-rodalies-3d/poller/internal/db"
	"github.com/mini-rodalies-3d/poller/internal/static/gtfs"
	tmbgen "github.com/mini-rodalies-3d/poller/internal/static/tmb"
)

func main() {
	// Command line flags
	dbPath := flag.String("db", "../../data/transit.db", "Path to SQLite database")
	gtfsDir := flag.String("gtfs-dir", "../../data/gtfs", "Directory containing GTFS zip files")
	geojsonDir := flag.String("geojson-dir", "", "If set, generate GeoJSON files for tram/fgc into this tmb_data directory")
	flag.Parse()

	// Initialize database
	database, err := db.Connect(*dbPath)
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}
	defer database.Close()

	log.Printf("Connected to database: %s", *dbPath)

	// Ensure schema exists (creates tables if needed)
	ctx := context.Background()
	if err := database.EnsureSchema(ctx); err != nil {
		log.Fatalf("Failed to ensure schema: %v", err)
	}

	// Find all GTFS zip files
	entries, err := os.ReadDir(*gtfsDir)
	if err != nil {
		log.Fatalf("Failed to read GTFS directory: %v", err)
	}

	// Track parsed GTFS data for GeoJSON generation
	tramDataSets := []*gtfs.Data{}

	var fgcData *gtfs.Data

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".zip") {
			continue
		}

		zipPath := filepath.Join(*gtfsDir, entry.Name())
		network := deriveNetworkName(entry.Name())

		log.Printf("Processing %s as network '%s'...", entry.Name(), network)

		if err := importGTFS(database, zipPath, network); err != nil {
			log.Printf("ERROR importing %s: %v", entry.Name(), err)
			continue
		}
		log.Printf("SUCCESS: %s imported", entry.Name())

		// Keep parsed data for GeoJSON generation
		if *geojsonDir != "" {
			data, err := gtfs.Parse(zipPath)
			if err != nil {
				log.Printf("Warning: failed to re-parse %s for GeoJSON: %v", entry.Name(), err)
				continue
			}
			switch {
			case strings.HasPrefix(network, "tram"):
				tramDataSets = append(tramDataSets, data)
			case network == "fgc":
				fgcData = data
			}
		}
	}

	// Generate GeoJSON files for tram and FGC
	if *geojsonDir != "" {
		if len(tramDataSets) > 0 {
			merged := mergeGTFSData(tramDataSets)
			log.Printf("Generating TRAM GeoJSON (%d routes, %d stops)...", len(merged.Routes), len(merged.Stops))
			if err := tmbgen.GenerateNetwork(merged, *geojsonDir, "tram"); err != nil {
				log.Printf("ERROR generating tram GeoJSON: %v", err)
			}
		}
		if fgcData != nil {
			log.Printf("Generating FGC GeoJSON (%d routes, %d stops)...", len(fgcData.Routes), len(fgcData.Stops))
			if err := tmbgen.GenerateNetwork(fgcData, *geojsonDir, "fgc"); err != nil {
				log.Printf("ERROR generating fgc GeoJSON: %v", err)
			}
		}
		// Regenerate manifest to include new tram/fgc entries
		if err := tmbgen.GenerateManifest(*geojsonDir); err != nil {
			log.Printf("ERROR regenerating manifest: %v", err)
		}
	}

	log.Println("Import complete!")
}

// deriveNetworkName extracts network identifier from filename
func deriveNetworkName(filename string) string {
	name := strings.TrimSuffix(filename, ".zip")
	name = strings.TrimSuffix(name, "_gtfs")

	// Normalize names
	switch {
	case strings.Contains(name, "fomento") || strings.Contains(name, "rodalies"):
		return "rodalies"
	case strings.Contains(name, "fgc"):
		return "fgc"
	case strings.Contains(name, "tbx") || strings.Contains(name, "trambaix"):
		return "tram_tbx"
	case strings.Contains(name, "tbs") || strings.Contains(name, "trambesos"):
		return "tram_tbs"
	case strings.Contains(name, "tmb_bus") || strings.Contains(name, "tmb-bus"):
		return "bus"
	default:
		return name
	}
}

func importGTFS(database *db.DB, zipPath, network string) error {
	// Parse GTFS
	data, err := gtfs.Parse(zipPath)
	if err != nil {
		return err
	}

	log.Printf("  Parsed: %d routes, %d stops, %d trips, %d stop_times",
		len(data.Routes), len(data.Stops), len(data.Trips), len(data.StopTimes))

	// For bus network, filter to only bus routes (route_type=3)
	// TMB GTFS contains both Metro (type=1) and Bus (type=3)
	var filteredRoutes []gtfs.Route
	busRouteIDs := make(map[string]bool)

	if network == "bus" {
		for _, r := range data.Routes {
			if r.RouteType == 3 { // 3 = Bus in GTFS spec
				filteredRoutes = append(filteredRoutes, r)
				busRouteIDs[r.RouteID] = true
			}
		}
		log.Printf("  Filtered to %d bus routes (from %d total)", len(filteredRoutes), len(data.Routes))
		data.Routes = filteredRoutes
	}

	ctx := context.Background()

	// Convert and insert stops
	stops := make([]db.GTFSStop, 0, len(data.Stops))
	for _, s := range data.Stops {
		stops = append(stops, db.GTFSStop{
			StopID:   s.StopID,
			StopCode: s.StopCode,
			StopName: s.StopName,
			StopLat:  s.StopLat,
			StopLon:  s.StopLon,
		})
	}

	// Convert and insert trips (filtered for bus network)
	trips := make([]db.GTFSTrip, 0, len(data.Trips))
	busTripIDs := make(map[string]bool)
	for _, t := range data.Trips {
		// Skip trips that don't belong to bus routes
		if network == "bus" && !busRouteIDs[t.RouteID] {
			continue
		}
		trips = append(trips, db.GTFSTrip{
			TripID:       t.TripID,
			RouteID:      t.RouteID,
			ServiceID:    t.ServiceID,
			TripHeadsign: t.TripHeadsign,
			DirectionID:  t.DirectionID,
		})
		busTripIDs[t.TripID] = true
	}

	if network == "bus" {
		log.Printf("  Filtered to %d bus trips", len(trips))
	}

	// Convert and insert stop times (filtered for bus network)
	stopTimes := make([]db.GTFSStopTime, 0, len(data.StopTimes))
	for _, st := range data.StopTimes {
		// Skip stop_times that don't belong to bus trips
		if network == "bus" && !busTripIDs[st.TripID] {
			continue
		}
		arrivalSecs := parseTimeToSeconds(st.ArrivalTime)
		departureSecs := parseTimeToSeconds(st.DepartureTime)
		stopTimes = append(stopTimes, db.GTFSStopTime{
			TripID:           st.TripID,
			StopID:           st.StopID,
			StopSequence:     st.StopSequence,
			ArrivalSeconds:   arrivalSecs,
			DepartureSeconds: departureSecs,
		})
	}

	if network == "bus" {
		log.Printf("  Filtered to %d bus stop_times", len(stopTimes))
	}

	// Insert core dimension data
	if err := database.UpsertGTFSDimensionData(ctx, network, stops, trips, stopTimes); err != nil {
		return err
	}

	log.Printf("  Inserted dimension data")

	// Convert and insert routes
	routes := make([]db.GTFSRoute, 0, len(data.Routes))
	for _, r := range data.Routes {
		routes = append(routes, db.GTFSRoute{
			RouteID:        r.RouteID,
			RouteShortName: r.RouteShortName,
			RouteLongName:  r.RouteLongName,
			RouteType:      r.RouteType,
			RouteColor:     r.RouteColor,
			RouteTextColor: r.RouteTextColor,
		})
	}
	if err := database.UpsertGTFSRouteData(ctx, network, routes); err != nil {
		log.Printf("  Warning: routes insert failed: %v", err)
	} else {
		log.Printf("  Inserted %d routes", len(routes))
	}

	// Build set of service_ids used by trips (for bus filtering)
	busServiceIDs := make(map[string]bool)
	if network == "bus" {
		for _, t := range trips {
			busServiceIDs[t.ServiceID] = true
		}
	}

	// Convert and insert calendar data (filtered for bus network)
	calendars := make([]db.GTFSCalendar, 0, len(data.Calendars))
	for _, c := range data.Calendars {
		if network == "bus" && !busServiceIDs[c.ServiceID] {
			continue
		}
		calendars = append(calendars, db.GTFSCalendar{
			ServiceID: c.ServiceID,
			Monday:    c.Monday,
			Tuesday:   c.Tuesday,
			Wednesday: c.Wednesday,
			Thursday:  c.Thursday,
			Friday:    c.Friday,
			Saturday:  c.Saturday,
			Sunday:    c.Sunday,
			StartDate: c.StartDate,
			EndDate:   c.EndDate,
		})
	}

	calendarDates := make([]db.GTFSCalendarDate, 0, len(data.CalendarDates))
	for _, cd := range data.CalendarDates {
		if network == "bus" && !busServiceIDs[cd.ServiceID] {
			continue
		}
		calendarDates = append(calendarDates, db.GTFSCalendarDate{
			ServiceID:     cd.ServiceID,
			Date:          cd.Date,
			ExceptionType: cd.ExceptionType,
		})
	}

	if network == "bus" {
		log.Printf("  Filtered to %d bus calendars, %d bus calendar_dates", len(calendars), len(calendarDates))
	}

	if err := database.UpsertGTFSCalendarData(ctx, network, calendars, calendarDates); err != nil {
		log.Printf("  Warning: calendar insert failed: %v", err)
	} else {
		log.Printf("  Inserted %d calendars, %d calendar_dates", len(calendars), len(calendarDates))
	}

	return nil
}

// parseTimeToSeconds converts GTFS time format (HH:MM:SS) to seconds since midnight
func parseTimeToSeconds(timeStr string) int {
	if timeStr == "" {
		return 0
	}
	parts := strings.Split(timeStr, ":")
	if len(parts) < 2 {
		return 0
	}
	var hours, minutes, seconds int
	if len(parts) >= 1 {
		hours = parseIntSafe(parts[0])
	}
	if len(parts) >= 2 {
		minutes = parseIntSafe(parts[1])
	}
	if len(parts) >= 3 {
		seconds = parseIntSafe(parts[2])
	}
	return hours*3600 + minutes*60 + seconds
}

func parseIntSafe(s string) int {
	var result int
	for _, c := range s {
		if c >= '0' && c <= '9' {
			result = result*10 + int(c-'0')
		}
	}
	return result
}

// mergeGTFSData combines multiple parsed GTFS datasets (e.g., tram_tbs + tram_tbx).
// Shape IDs are prefixed per dataset to avoid collisions (both zips use "1", "2", etc.).
func mergeGTFSData(datasets []*gtfs.Data) *gtfs.Data {
	merged := &gtfs.Data{
		Shapes: make(map[string][]gtfs.ShapePoint),
	}
	for i, d := range datasets {
		prefix := fmt.Sprintf("ds%d_", i)
		merged.Routes = append(merged.Routes, d.Routes...)
		merged.Stops = append(merged.Stops, d.Stops...)
		merged.Calendars = append(merged.Calendars, d.Calendars...)
		merged.CalendarDates = append(merged.CalendarDates, d.CalendarDates...)
		// Namespace shape IDs and update trip references to match
		for j := range d.Trips {
			trip := d.Trips[j]
			if trip.ShapeID != "" {
				trip.ShapeID = prefix + trip.ShapeID
			}
			merged.Trips = append(merged.Trips, trip)
		}
		merged.StopTimes = append(merged.StopTimes, d.StopTimes...)
		for k, v := range d.Shapes {
			merged.Shapes[prefix+k] = v
		}
	}
	return merged
}
