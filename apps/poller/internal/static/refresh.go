package static

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
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
	UpdatedAt    string `json:"updated_at"`              // When the manifest was last updated
	GeneratedAt  string `json:"generated_at"`            // Legacy field, also check this
	Version      string `json:"version"`
	GTFSChecksum string `json:"gtfs_checksum,omitempty"` // SHA256 of source GTFS zip
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
		// File doesn't exist — trigger refresh so the poller self-heals
		// even when init-db was skipped or the volume is empty
		log.Printf("Manifest not found at %s, triggering refresh", manifestPath)
		return true
	}

	var manifest Manifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		log.Printf("Failed to parse manifest %s: %v", manifestPath, err)
		return true
	}

	// Try updated_at first (new format), fall back to generated_at (legacy)
	timestamp := manifest.UpdatedAt
	if timestamp == "" {
		timestamp = manifest.GeneratedAt
	}
	if timestamp == "" {
		log.Printf("No timestamp found in manifest %s", manifestPath)
		return true
	}

	generatedAt, err := time.Parse(time.RFC3339, timestamp)
	if err != nil {
		log.Printf("Failed to parse timestamp %s in manifest: %v", timestamp, err)
		return true
	}

	age := time.Since(generatedAt)
	maxAge := time.Duration(maxAgeDays) * 24 * time.Hour

	if age > maxAge {
		log.Printf("Manifest %s is stale (age: %v, max: %v)", manifestPath, age.Round(time.Hour), maxAge)
		return true
	}

	return false
}

func refreshRodalies(cfg *config.Config, database *db.DB) error {
	// Download GTFS zip
	zipPath := filepath.Join(cfg.CacheDir, "renfe_gtfs.zip")
	if err := gtfs.Download(cfg.RenfeGTFSURL, zipPath); err != nil {
		return err
	}

	// Calculate checksum of downloaded file
	newChecksum, err := fileChecksum(zipPath)
	if err != nil {
		log.Printf("Warning: failed to calculate checksum: %v", err)
		// Continue with refresh if checksum fails
	} else {
		// Compare with stored checksum
		manifestPath := filepath.Join(cfg.WebPublicDir, "rodalies_data", "manifest.json")
		oldChecksum := getStoredChecksum(manifestPath)
		if oldChecksum != "" && oldChecksum == newChecksum {
			log.Printf("Rodalies GTFS unchanged (checksum: %s...)", newChecksum[:12])
			// Update manifest timestamp but skip expensive parsing
			updateManifestTimestamp(manifestPath, newChecksum)
			return nil
		}
		log.Printf("Rodalies GTFS changed (old: %s, new: %s), refreshing...",
			truncateChecksum(oldChecksum), truncateChecksum(newChecksum))
	}

	// Parse GTFS data (only when checksum differs)
	data, err := gtfs.Parse(zipPath)
	if err != nil {
		return err
	}

	// Generate GeoJSON files
	outputDir := filepath.Join(cfg.WebPublicDir, "rodalies_data")
	if err := rodaliesgen.Generate(data, outputDir); err != nil {
		return err
	}

	// Store checksum in manifest for next comparison
	if newChecksum != "" {
		storeChecksumInManifest(filepath.Join(outputDir, "manifest.json"), newChecksum)
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

	// Calculate checksum of downloaded file
	newChecksum, err := fileChecksum(zipPath)
	if err != nil {
		log.Printf("Warning: failed to calculate TMB checksum: %v", err)
	} else {
		// Compare with stored checksum
		manifestPath := filepath.Join(cfg.WebPublicDir, "tmb_data", "manifest.json")
		oldChecksum := getStoredChecksum(manifestPath)
		if oldChecksum != "" && oldChecksum == newChecksum {
			log.Printf("TMB GTFS unchanged (checksum: %s...)", newChecksum[:12])
			updateManifestTimestamp(manifestPath, newChecksum)
			return nil
		}
		log.Printf("TMB GTFS changed (old: %s, new: %s), refreshing...",
			truncateChecksum(oldChecksum), truncateChecksum(newChecksum))
	}

	// Parse GTFS data (only when checksum differs)
	data, err := gtfs.Parse(zipPath)
	if err != nil {
		return err
	}

	// Generate GeoJSON files
	outputDir := filepath.Join(cfg.WebPublicDir, "tmb_data")
	if err := tmbgen.Generate(data, outputDir); err != nil {
		return err
	}

	// Store checksum in manifest
	if newChecksum != "" {
		storeChecksumInManifest(filepath.Join(outputDir, "manifest.json"), newChecksum)
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

// RodaliesCatalunyaLines defines the Rodalies de Catalunya lines (Barcelona area only).
// The Renfe GTFS contains all of Spain's Cercanías, but we only need Barcelona.
// Note: C1-C10 are Cercanías from other regions (Madrid, etc.), NOT Barcelona.
var RodaliesCatalunyaLines = map[string]bool{
	"R1": true, "R2": true, "R2N": true, "R2S": true,
	"R3": true, "R4": true, "R7": true, "R8": true,
	"R11": true, "R12": true, "R13": true, "R14": true,
	"R15": true, "R16": true, "R17": true,
	"RG1": true, "RL3": true, "RL4": true,
	"RT1": true, "RT2": true,
}

// populateDimensionTables converts GTFS data to dimension table format and inserts into database
func populateDimensionTables(database *db.DB, network string, data *gtfs.Data) error {
	ctx := context.Background()

	// For Rodalies, filter to only Barcelona/Catalunya lines
	// This reduces 1.85M stop_times (all of Spain) to ~100K (just Barcelona)
	filterToCatalunya := (network == "rodalies")

	// Build route filter: route_id -> keep?
	routeFilter := make(map[string]bool)
	if filterToCatalunya {
		for _, r := range data.Routes {
			lineCode := strings.ToUpper(r.RouteShortName)
			if RodaliesCatalunyaLines[lineCode] {
				routeFilter[r.RouteID] = true
			}
		}
		log.Printf("Filtering to %d Rodalies Catalunya routes (from %d total Spain routes)",
			len(routeFilter), len(data.Routes))
	}

	// Build trip filter based on routes
	tripFilter := make(map[string]bool)
	if filterToCatalunya {
		for _, t := range data.Trips {
			if routeFilter[t.RouteID] {
				tripFilter[t.TripID] = true
			}
		}
		log.Printf("Filtering to %d Catalunya trips (from %d total)", len(tripFilter), len(data.Trips))
	}

	// Convert stops - for Catalunya, only include stops used by filtered trips
	stopsUsed := make(map[string]bool)
	if filterToCatalunya {
		for _, st := range data.StopTimes {
			if tripFilter[st.TripID] {
				stopsUsed[st.StopID] = true
			}
		}
	}

	stops := make([]db.GTFSStop, 0)
	for _, s := range data.Stops {
		if filterToCatalunya && !stopsUsed[s.StopID] {
			continue
		}
		stops = append(stops, db.GTFSStop{
			StopID:   s.StopID,
			StopCode: s.StopCode,
			StopName: s.StopName,
			StopLat:  s.StopLat,
			StopLon:  s.StopLon,
		})
	}

	// Convert trips - filter if needed
	trips := make([]db.GTFSTrip, 0)
	for _, t := range data.Trips {
		if filterToCatalunya && !tripFilter[t.TripID] {
			continue
		}
		trips = append(trips, db.GTFSTrip{
			TripID:       t.TripID,
			RouteID:      t.RouteID,
			ServiceID:    t.ServiceID,
			TripHeadsign: t.TripHeadsign,
			DirectionID:  t.DirectionID,
		})
	}

	// Convert stop times - filter if needed
	stopTimes := make([]db.GTFSStopTime, 0)
	for _, st := range data.StopTimes {
		if filterToCatalunya && !tripFilter[st.TripID] {
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

	if filterToCatalunya {
		log.Printf("Filtered: %d stops, %d trips, %d stop_times (Catalunya only)",
			len(stops), len(trips), len(stopTimes))
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

// fileChecksum calculates SHA256 checksum of a file
func fileChecksum(filePath string) (string, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}

	return hex.EncodeToString(h.Sum(nil)), nil
}

// getStoredChecksum reads the GTFS checksum from a manifest file
func getStoredChecksum(manifestPath string) string {
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		return ""
	}

	var manifest Manifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return ""
	}

	return manifest.GTFSChecksum
}

// storeChecksumInManifest updates the GTFS checksum in an existing manifest file
func storeChecksumInManifest(manifestPath, checksum string) {
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		log.Printf("Warning: failed to read manifest for checksum update: %v", err)
		return
	}

	// Parse as generic map to preserve all existing fields
	var manifest map[string]interface{}
	if err := json.Unmarshal(data, &manifest); err != nil {
		log.Printf("Warning: failed to parse manifest for checksum update: %v", err)
		return
	}

	manifest["gtfs_checksum"] = checksum

	updatedData, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		log.Printf("Warning: failed to marshal manifest with checksum: %v", err)
		return
	}

	if err := os.WriteFile(manifestPath, updatedData, 0644); err != nil {
		log.Printf("Warning: failed to write manifest with checksum: %v", err)
	}
}

// updateManifestTimestamp updates the timestamp in manifest without changing other fields
func updateManifestTimestamp(manifestPath, checksum string) {
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		return
	}

	var manifest map[string]interface{}
	if err := json.Unmarshal(data, &manifest); err != nil {
		return
	}

	// Update timestamp fields that indicate freshness
	manifest["updated_at"] = time.Now().UTC().Format(time.RFC3339)
	manifest["gtfs_checksum"] = checksum

	updatedData, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return
	}

	os.WriteFile(manifestPath, updatedData, 0644)
}

// truncateChecksum returns first 12 chars of checksum for logging, or "none" if empty
func truncateChecksum(checksum string) string {
	if checksum == "" {
		return "none"
	}
	if len(checksum) > 12 {
		return checksum[:12] + "..."
	}
	return checksum
}
