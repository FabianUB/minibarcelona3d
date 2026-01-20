package static

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/mini-rodalies-3d/poller/internal/config"
	"github.com/mini-rodalies-3d/poller/internal/db"
	"github.com/mini-rodalies-3d/poller/internal/static/gtfs"
	rodaliesgen "github.com/mini-rodalies-3d/poller/internal/static/rodalies"
	tmbgen "github.com/mini-rodalies-3d/poller/internal/static/tmb"
)

// Manifest represents the manifest.json structure
type Manifest struct {
	GeneratedAt string `json:"generated_at"`
	Version     string `json:"version"`
}

// RefreshIfStale checks manifest files and refreshes data if older than threshold
// If database is provided, dimension tables will also be populated
func RefreshIfStale(cfg *config.Config, database *db.DB) error {
	rodaliesManifest := filepath.Join(cfg.WebPublicDir, "rodalies_data", "manifest.json")
	tmbManifest := filepath.Join(cfg.WebPublicDir, "tmb_data", "manifest.json")

	rodaliesStale := isStaleOrMissing(rodaliesManifest, cfg.StaticRefreshDays)
	tmbStale := isStaleOrMissing(tmbManifest, cfg.StaticRefreshDays)

	if !rodaliesStale && !tmbStale {
		log.Println("Static data is fresh, skipping refresh")
		return nil
	}

	// Ensure cache directory exists
	if err := os.MkdirAll(cfg.CacheDir, 0755); err != nil {
		return err
	}

	// Refresh Rodalies data
	if rodaliesStale {
		log.Println("Refreshing Rodalies static data...")
		if err := refreshRodalies(cfg, database); err != nil {
			log.Printf("Failed to refresh Rodalies data: %v", err)
		} else {
			log.Println("Rodalies static data refreshed successfully")
		}
	}

	// Refresh TMB data
	if tmbStale {
		log.Println("Refreshing TMB static data...")
		if err := refreshTMB(cfg, database); err != nil {
			log.Printf("Failed to refresh TMB data: %v", err)
		} else {
			log.Println("TMB static data refreshed successfully")
		}
	}

	return nil
}

func isStaleOrMissing(manifestPath string, maxAgeDays int) bool {
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		// File doesn't exist - skip refresh (init-db handles first-time setup)
		// Only refresh if we previously generated data and it's now stale
		log.Printf("Manifest not found at %s, skipping refresh (use init-db for first-time setup)", manifestPath)
		return false
	}

	var manifest Manifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return true
	}

	generatedAt, err := time.Parse(time.RFC3339, manifest.GeneratedAt)
	if err != nil {
		return true
	}

	age := time.Since(generatedAt)
	maxAge := time.Duration(maxAgeDays) * 24 * time.Hour

	return age > maxAge
}

func refreshRodalies(cfg *config.Config, database *db.DB) error {
	// Download GTFS zip
	zipPath := filepath.Join(cfg.CacheDir, "renfe_gtfs.zip")
	if err := gtfs.Download(cfg.RenfeGTFSURL, zipPath); err != nil {
		return err
	}

	// Parse GTFS data
	data, err := gtfs.Parse(zipPath)
	if err != nil {
		return err
	}

	// Generate GeoJSON files
	outputDir := filepath.Join(cfg.WebPublicDir, "rodalies_data")
	if err := rodaliesgen.Generate(data, outputDir); err != nil {
		return err
	}

	// Populate dimension tables if database is provided
	if database != nil {
		if err := populateDimensionTables(database, "rodalies", data); err != nil {
			log.Printf("Warning: failed to populate Rodalies dimension tables: %v", err)
			// Don't fail the whole refresh if dimension tables fail
		} else {
			log.Printf("Rodalies dimension tables populated: %d stops, %d trips, %d stop_times",
				len(data.Stops), len(data.Trips), len(data.StopTimes))
		}
	}

	return nil
}

func refreshTMB(cfg *config.Config, database *db.DB) error {
	// Check if TMB credentials are configured
	if cfg.TMBAppID == "" || cfg.TMBAppKey == "" {
		log.Println("TMB API credentials not configured, skipping TMB refresh")
		return nil
	}

	// Download GTFS zip with credentials
	zipPath := filepath.Join(cfg.CacheDir, "tmb_gtfs.zip")
	url := cfg.TMBGTFSURL
	if url == "" {
		url = "https://api.tmb.cat/v1/static/datasets/gtfs.zip"
	}

	if err := gtfs.DownloadWithAuth(url, zipPath, cfg.TMBAppID, cfg.TMBAppKey); err != nil {
		return err
	}

	// Parse GTFS data
	data, err := gtfs.Parse(zipPath)
	if err != nil {
		return err
	}

	// Generate GeoJSON files
	outputDir := filepath.Join(cfg.WebPublicDir, "tmb_data")
	if err := tmbgen.Generate(data, outputDir); err != nil {
		return err
	}

	// Populate dimension tables if database is provided
	if database != nil {
		if err := populateDimensionTables(database, "tmb", data); err != nil {
			log.Printf("Warning: failed to populate TMB dimension tables: %v", err)
		} else {
			log.Printf("TMB dimension tables populated: %d stops, %d trips, %d stop_times",
				len(data.Stops), len(data.Trips), len(data.StopTimes))
		}
	}

	return nil
}

// populateDimensionTables converts GTFS data to dimension table format and inserts into database
func populateDimensionTables(database *db.DB, network string, data *gtfs.Data) error {
	ctx := context.Background()

	// Convert stops
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

	// Convert trips
	trips := make([]db.GTFSTrip, 0, len(data.Trips))
	for _, t := range data.Trips {
		trips = append(trips, db.GTFSTrip{
			TripID:       t.TripID,
			RouteID:      t.RouteID,
			ServiceID:    t.ServiceID,
			TripHeadsign: t.TripHeadsign,
			DirectionID:  t.DirectionID,
		})
	}

	// Convert stop times
	stopTimes := make([]db.GTFSStopTime, 0, len(data.StopTimes))
	for _, st := range data.StopTimes {
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

	// Upsert core dimension data (stops, trips, stop_times)
	if err := database.UpsertGTFSDimensionData(ctx, network, stops, trips, stopTimes); err != nil {
		return err
	}

	// Convert and upsert routes
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
		log.Printf("Warning: failed to populate routes for %s: %v", network, err)
	} else {
		log.Printf("%s routes populated: %d routes", network, len(routes))
	}

	// Convert and upsert calendar data
	calendars := make([]db.GTFSCalendar, 0, len(data.Calendars))
	for _, c := range data.Calendars {
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
		calendarDates = append(calendarDates, db.GTFSCalendarDate{
			ServiceID:     cd.ServiceID,
			Date:          cd.Date,
			ExceptionType: cd.ExceptionType,
		})
	}

	if err := database.UpsertGTFSCalendarData(ctx, network, calendars, calendarDates); err != nil {
		log.Printf("Warning: failed to populate calendar for %s: %v", network, err)
	} else {
		log.Printf("%s calendar populated: %d calendars, %d calendar_dates", network, len(calendars), len(calendarDates))
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
		_, _ = strings.NewReader(parts[0]).Read(make([]byte, 0))
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
