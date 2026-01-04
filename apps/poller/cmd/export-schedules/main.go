package main

import (
	"archive/zip"
	"encoding/csv"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// StopTime represents a scheduled stop
type StopTime struct {
	StopID           string `json:"stopId"`
	StopSequence     int    `json:"seq"`
	ArrivalSeconds   int    `json:"arr"` // seconds since midnight
	DepartureSeconds int    `json:"dep"` // seconds since midnight
}

// Trip represents a scheduled trip with its stops
type Trip struct {
	TripID      string     `json:"tripId"`
	RouteID     string     `json:"routeId"`
	DirectionID int        `json:"direction"`
	Headsign    string     `json:"headsign,omitempty"`
	ServiceID   string     `json:"-"` // Not exported, used for filtering
	Stops       []StopTime `json:"stops"`
}

// DaySchedule represents all trips for a specific date
type DaySchedule struct {
	Network string            `json:"network"`
	Date    string            `json:"date"` // YYYYMMDD
	Trips   map[string][]Trip `json:"tripsByRoute"`
}

func main() {
	gtfsDir := flag.String("gtfs-dir", "../../data/gtfs", "Directory containing GTFS zip files")
	outputDir := flag.String("output", "../../apps/web/public/tmb_data/schedules", "Output directory for schedule JSONs")
	days := flag.Int("days", 14, "Number of days to export from today")
	flag.Parse()

	// Create output directory
	if err := os.MkdirAll(*outputDir, 0755); err != nil {
		log.Fatalf("Failed to create output directory: %v", err)
	}

	// Process each GTFS file
	entries, err := os.ReadDir(*gtfsDir)
	if err != nil {
		log.Fatalf("Failed to read GTFS directory: %v", err)
	}

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".zip") {
			continue
		}

		zipPath := filepath.Join(*gtfsDir, entry.Name())
		network := deriveNetworkName(entry.Name())

		log.Printf("Processing %s as network '%s'...", entry.Name(), network)

		if err := processGTFS(zipPath, network, *outputDir, *days); err != nil {
			log.Printf("ERROR processing %s: %v", entry.Name(), err)
		} else {
			log.Printf("SUCCESS: %s exported", entry.Name())
		}
	}

	log.Println("Export complete!")
}

func deriveNetworkName(filename string) string {
	name := strings.TrimSuffix(filename, ".zip")
	name = strings.TrimSuffix(name, "_gtfs")

	switch {
	case strings.Contains(name, "fgc"):
		return "fgc"
	case strings.Contains(name, "tbx"):
		return "tram_tbx"
	case strings.Contains(name, "tbs"):
		return "tram_tbs"
	default:
		return name
	}
}

func processGTFS(zipPath, network, outputDir string, days int) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer r.Close()

	// Parse all data
	routes := make(map[string]string)       // routeId -> shortName
	trips := make(map[string]*Trip)         // tripId -> Trip
	stopTimes := make(map[string][]StopTime) // tripId -> []StopTime
	calendarDates := make(map[string][]string) // date -> []serviceId

	for _, f := range r.File {
		switch f.Name {
		case "routes.txt":
			if err := parseRoutes(f, routes); err != nil {
				return fmt.Errorf("routes.txt: %w", err)
			}
		case "trips.txt":
			if err := parseTrips(f, trips, routes); err != nil {
				return fmt.Errorf("trips.txt: %w", err)
			}
		case "stop_times.txt":
			if err := parseStopTimes(f, stopTimes); err != nil {
				return fmt.Errorf("stop_times.txt: %w", err)
			}
		case "calendar_dates.txt":
			if err := parseCalendarDates(f, calendarDates); err != nil {
				return fmt.Errorf("calendar_dates.txt: %w", err)
			}
		}
	}

	log.Printf("  Parsed: %d routes, %d trips, %d dates with service",
		len(routes), len(trips), len(calendarDates))

	// Attach stop_times to trips
	for tripID, stops := range stopTimes {
		if trip, ok := trips[tripID]; ok {
			sort.Slice(stops, func(i, j int) bool {
				return stops[i].StopSequence < stops[j].StopSequence
			})
			trip.Stops = stops
		}
	}

	// Build service -> trips mapping
	serviceTrips := make(map[string][]*Trip)
	for _, trip := range trips {
		if trip.ServiceID != "" && len(trip.Stops) > 0 {
			serviceTrips[trip.ServiceID] = append(serviceTrips[trip.ServiceID], trip)
		}
	}

	log.Printf("  Found %d unique service patterns", len(serviceTrips))

	// Export schedules for each day
	loc := barcelonaLocation()
	today := time.Now().In(loc)

	exportedDates := 0
	for i := 0; i < days; i++ {
		date := today.AddDate(0, 0, i)
		dateStr := date.Format("20060102")

		services, ok := calendarDates[dateStr]
		if !ok || len(services) == 0 {
			continue
		}

		schedule := &DaySchedule{
			Network: network,
			Date:    dateStr,
			Trips:   make(map[string][]Trip),
		}

		// Collect all trips for active services
		totalTrips := 0
		for _, serviceID := range services {
			if tripsForService, ok := serviceTrips[serviceID]; ok {
				for _, trip := range tripsForService {
					// Copy trip without internal fields
					exportTrip := Trip{
						TripID:      trip.TripID,
						RouteID:     trip.RouteID,
						DirectionID: trip.DirectionID,
						Headsign:    trip.Headsign,
						Stops:       trip.Stops,
					}
					schedule.Trips[trip.RouteID] = append(schedule.Trips[trip.RouteID], exportTrip)
					totalTrips++
				}
			}
		}

		if totalTrips == 0 {
			continue
		}

		// Sort trips within each route by first stop time
		for routeID := range schedule.Trips {
			sort.Slice(schedule.Trips[routeID], func(i, j int) bool {
				if len(schedule.Trips[routeID][i].Stops) == 0 {
					return true
				}
				if len(schedule.Trips[routeID][j].Stops) == 0 {
					return false
				}
				return schedule.Trips[routeID][i].Stops[0].DepartureSeconds <
				       schedule.Trips[routeID][j].Stops[0].DepartureSeconds
			})
		}

		// Export
		outPath := filepath.Join(outputDir, fmt.Sprintf("%s_%s.json", network, dateStr))
		if err := exportSchedule(schedule, outPath); err != nil {
			log.Printf("  Failed to export %s: %v", dateStr, err)
		} else {
			log.Printf("  Exported %s (%s): %d trips across %d routes",
				dateStr, date.Weekday(), totalTrips, len(schedule.Trips))
			exportedDates++
		}
	}

	if exportedDates == 0 {
		log.Printf("  WARNING: No schedules exported - check calendar_dates coverage")
	}

	return nil
}

func barcelonaLocation() *time.Location {
	loc, err := time.LoadLocation("Europe/Madrid")
	if err != nil {
		return time.FixedZone("CET", 3600)
	}
	return loc
}

func parseRoutes(f *zip.File, routes map[string]string) error {
	rc, err := f.Open()
	if err != nil {
		return err
	}
	defer rc.Close()

	reader := csv.NewReader(rc)
	headers, err := reader.Read()
	if err != nil {
		return err
	}

	idx := makeIndex(headers)

	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			continue
		}

		routeID := safeGet(record, idx["route_id"])
		shortName := safeGet(record, idx["route_short_name"])
		if routeID != "" {
			routes[routeID] = shortName
		}
	}

	return nil
}

func parseTrips(f *zip.File, trips map[string]*Trip, routes map[string]string) error {
	rc, err := f.Open()
	if err != nil {
		return err
	}
	defer rc.Close()

	reader := csv.NewReader(rc)
	headers, err := reader.Read()
	if err != nil {
		return err
	}

	idx := makeIndex(headers)

	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			continue
		}

		tripID := safeGet(record, idx["trip_id"])
		if tripID == "" {
			continue
		}

		direction := 0
		if d := safeGet(record, idx["direction_id"]); d != "" {
			direction, _ = strconv.Atoi(d)
		}

		routeID := safeGet(record, idx["route_id"])
		// Use route short name if available
		if shortName, ok := routes[routeID]; ok && shortName != "" {
			routeID = shortName
		}

		trips[tripID] = &Trip{
			TripID:      tripID,
			RouteID:     routeID,
			DirectionID: direction,
			Headsign:    safeGet(record, idx["trip_headsign"]),
			ServiceID:   safeGet(record, idx["service_id"]),
		}
	}

	return nil
}

func parseStopTimes(f *zip.File, stopTimes map[string][]StopTime) error {
	rc, err := f.Open()
	if err != nil {
		return err
	}
	defer rc.Close()

	reader := csv.NewReader(rc)
	headers, err := reader.Read()
	if err != nil {
		return err
	}

	idx := makeIndex(headers)

	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			continue
		}

		tripID := safeGet(record, idx["trip_id"])
		if tripID == "" {
			continue
		}

		seq := 0
		if s := safeGet(record, idx["stop_sequence"]); s != "" {
			seq, _ = strconv.Atoi(s)
		}

		st := StopTime{
			StopID:           safeGet(record, idx["stop_id"]),
			StopSequence:     seq,
			ArrivalSeconds:   parseTimeToSeconds(safeGet(record, idx["arrival_time"])),
			DepartureSeconds: parseTimeToSeconds(safeGet(record, idx["departure_time"])),
		}

		stopTimes[tripID] = append(stopTimes[tripID], st)
	}

	return nil
}

func parseCalendarDates(f *zip.File, calendarDates map[string][]string) error {
	rc, err := f.Open()
	if err != nil {
		return err
	}
	defer rc.Close()

	reader := csv.NewReader(rc)
	headers, err := reader.Read()
	if err != nil {
		return err
	}

	idx := makeIndex(headers)

	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			continue
		}

		exType := 1
		if e := safeGet(record, idx["exception_type"]); e != "" {
			exType, _ = strconv.Atoi(e)
		}

		// Only include added services (exception_type = 1)
		if exType == 1 {
			date := safeGet(record, idx["date"])
			serviceID := safeGet(record, idx["service_id"])
			if date != "" && serviceID != "" {
				calendarDates[date] = append(calendarDates[date], serviceID)
			}
		}
	}

	return nil
}

func exportSchedule(schedule *DaySchedule, path string) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()

	encoder := json.NewEncoder(f)
	return encoder.Encode(schedule)
}

func makeIndex(headers []string) map[string]int {
	idx := make(map[string]int)
	for i, h := range headers {
		idx[strings.TrimSpace(strings.ToLower(h))] = i
	}
	return idx
}

func safeGet(record []string, idx int) string {
	if idx >= 0 && idx < len(record) {
		return strings.TrimSpace(record[idx])
	}
	return ""
}

func parseTimeToSeconds(timeStr string) int {
	if timeStr == "" {
		return 0
	}
	parts := strings.Split(timeStr, ":")
	if len(parts) < 2 {
		return 0
	}
	hours, _ := strconv.Atoi(parts[0])
	minutes, _ := strconv.Atoi(parts[1])
	seconds := 0
	if len(parts) >= 3 {
		seconds, _ = strconv.Atoi(parts[2])
	}
	return hours*3600 + minutes*60 + seconds
}
